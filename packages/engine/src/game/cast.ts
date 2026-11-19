// Casting a spell (CR 601.2), as a sequence of decisions. Progress is kept in `GameState.casting` and on the stack
// object, so every pause is plain data and a cancelled cast can be reversed exactly (CR 734.1, D-035).

import type { CardDatabase, ManaCost, TargetSpec } from "../cards/types.ts";
import { resolveManaAbility } from "../mana/activate.ts";
import { autoPay } from "../mana/auto-pay.ts";
import { type ManaPayment, payFromPool } from "../mana/payment.ts";
import { isLegalTarget, legalTargets } from "../rules/targets.ts";
import { castTimingProblem } from "../rules/timing.ts";
import type { Casting } from "../state/casting.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { AbilityRef, Target } from "../state/objects.ts";
import { moveCard } from "../zones/move-card.ts";
import { withZoneList, zoneList } from "../zones/zone-list.ts";
import { waitFor } from "./decide.ts";
import type { Progress } from "./progress.ts";
import { queueWork } from "./work.ts";

/** The target requirements of a card's spell, one per instance of "target" (CR 601.2c). */
export function targetSpecsOf(state: GameState, id: ObjectId, cards: CardDatabase): readonly TargetSpec[] {
  const obj = state.objects[id];
  if (obj?.kind !== "card") return [];
  return cards[obj.oracleId]?.def.spell?.targets ?? [];
}

function manaCostOf(state: GameState, id: ObjectId, cards: CardDatabase): ManaCost | null {
  const obj = state.objects[id];
  return obj?.kind === "card" ? (cards[obj.oracleId]?.printed.manaCost ?? null) : null;
}

/**
 * Why the player can't begin casting this card now, or null. Checked once, before the card moves (CR 601.2a): it's in
 * their hand, the timing allows it, every target requirement has a legal choice (CR 601.2c), and the cost can be paid
 * (CR 601.2h). So a spell that couldn't be completed is never offered.
 */
export function castProblem(state: GameState, player: PlayerId, card: ObjectId, cards: CardDatabase): string | null {
  if (!zoneList(state, { zone: "hand", player }).includes(card)) return `${card} isn't in ${player}'s hand`;
  const timing = castTimingProblem(state, player, card, cards);
  if (timing !== null) return timing;
  for (const spec of targetSpecsOf(state, card, cards)) {
    if (legalTargets(state, spec, cards).length === 0) return "there's nothing it could target (CR 601.2c)";
  }
  const cost = manaCostOf(state, card, cards);
  // A card with no mana cost can't be cast by paying it (CR 202.1b, 118.6); alternative costs come later.
  if (cost === null) return "it has no mana cost to pay";
  if (autoPay(state, player, cost, cards) === null) return "you can't pay its cost (CR 601.2h)";
  return null;
}

/** CR 601.2a: the card moves to the stack, and the cast continues with its targets and costs. */
export function startCast(state: GameState, player: PlayerId, card: ObjectId, cards: CardDatabase): Progress {
  const obj = state.objects[card];
  const ps = state.players[player];
  if (obj?.kind !== "card" || ps === undefined) throw new Error(`Can't cast ${card}`);
  const handIndex = zoneList(state, { zone: "hand", player }).indexOf(card);
  const moved = moveCard(state, card, { zone: "stack", controller: player });
  const casting: Casting = {
    player,
    spell: moved.newId,
    card: obj,
    handIndex,
    poolBefore: ps.manaPool,
    tappedForMana: [],
  };
  return { state: nextCastStep({ ...moved.state, casting }, cards), events: moved.events };
}

/** The next decision of the cast: the next target (CR 601.2c), then paying the cost (CR 601.2g–h). */
function nextCastStep(state: GameState, cards: CardDatabase): GameState {
  const casting = castingOf(state);
  const spell = state.objects[casting.spell];
  if (spell?.kind !== "card" || spell.choices === null) throw new Error("The spell isn't on the stack");
  const chosen = spell.choices.targets.length;
  if (chosen < targetSpecsOf(state, casting.spell, cards).length) {
    return waitFor(state, casting.player, { kind: "chooseTarget", spell: casting.spell, instance: chosen });
  }
  const cost = manaCostOf(state, casting.spell, cards) ?? [];
  return waitFor(state, casting.player, { kind: "payMana", spell: casting.spell, cost });
}

/** Why this target can't be chosen for the pending instance, or null. */
export function targetProblem(state: GameState, instance: number, target: Target, cards: CardDatabase): string | null {
  const casting = castingOf(state);
  const spec = targetSpecsOf(state, casting.spell, cards)[instance];
  if (spec === undefined || !isLegalTarget(state, spec, target, cards)) return "that isn't a legal target (CR 115)";
  return null;
}

export function chooseTarget(state: GameState, target: Target, cards: CardDatabase): Progress {
  const casting = castingOf(state);
  const spell = state.objects[casting.spell];
  if (spell?.kind !== "card" || spell.choices === null) throw new Error("The spell isn't on the stack");
  const choices = { ...spell.choices, targets: [...spell.choices.targets, [target]] };
  const next = { ...state, objects: { ...state.objects, [casting.spell]: { ...spell, choices } } };
  return { state: nextCastStep(next, cards), events: [] };
}

/**
 * While paying, the player activates a mana ability (CR 605.3a, 601.2g). It resolves at once; the payment decision is
 * asked again with the new mana in the pool. A permanent tapped for it untaps if the cast is reversed.
 */
export function activateWhilePaying(
  state: GameState,
  object: ObjectId,
  ability: AbilityRef,
  cards: CardDatabase,
): Progress {
  const casting = castingOf(state);
  const pending = state.pending;
  const resolved = resolveManaAbility({ ...state, pending: null }, casting.player, object, ability, cards);
  const tapped = resolved.events.flatMap((e) => (e.type === "PERMANENT_TAPPED" ? [e.object] : []));
  const next = { ...resolved.state, casting: { ...casting, tappedForMana: [...casting.tappedForMana, ...tapped] } };
  if (pending?.kind !== "payMana") throw new Error("Not paying for a spell");
  return {
    state: waitFor(next, casting.player, { kind: "payMana", spell: pending.spell, cost: pending.cost }),
    events: resolved.events,
  };
}

/**
 * CR 601.2h: the player pays the cost in full from their pool, then the spell becomes cast (CR 601.2i). They receive
 * priority (CR 117.3c), and everyone has to pass again (CR 117.4).
 */
export function payForSpell(state: GameState, cost: ManaCost, payment: ManaPayment): Progress | string {
  const casting = castingOf(state);
  const ps = state.players[casting.player];
  if (ps === undefined) throw new Error(`No player ${casting.player}`);
  const rest = payFromPool(ps.manaPool, cost, payment);
  if (rest === null) return "that payment doesn't pay the cost (CR 601.2h)";
  const spell = state.objects[casting.spell];
  if (spell?.kind !== "card") throw new Error("The spell isn't on the stack");
  const players = { ...state.players, [casting.player]: { ...ps, manaPool: rest } };
  const cast: GameState = { ...state, players, casting: null, passesInSuccession: 0 };
  return {
    state: queueWork(cast, { kind: "givePriority", player: casting.player }),
    events: [{ type: "SPELL_CAST", player: casting.player, object: casting.spell, cardId: spell.cardId }],
  };
}

/**
 * The player cancels: the whole cast is reversed (CR 734.1). The card returns to where it was in the hand as the same
 * object, the pool is as it was, and permanents tapped for mana during the cast untap; nothing triggers. The player
 * keeps priority (CR 734.2).
 */
export function cancelCast(state: GameState): Progress {
  const casting = castingOf(state);
  const { [casting.spell]: _spell, ...rest } = state.objects;
  const objects: GameState["objects"] = { ...rest, [casting.card.id]: casting.card };
  for (const id of casting.tappedForMana) {
    const obj = objects[id];
    if (obj?.kind === "card") objects[id] = { ...obj, tapped: false };
  }
  let next: GameState = { ...state, objects, casting: null };
  next = withZoneList(
    next,
    { zone: "stack" },
    next.zones.stack.filter((id) => id !== casting.spell),
  );
  const hand = [...zoneList(next, { zone: "hand", player: casting.player })];
  hand.splice(casting.handIndex, 0, casting.card.id);
  next = withZoneList(next, { zone: "hand", player: casting.player }, hand);
  const ps = next.players[casting.player];
  if (ps !== undefined)
    next = { ...next, players: { ...next.players, [casting.player]: { ...ps, manaPool: casting.poolBefore } } };
  return {
    state: queueWork(next, { kind: "givePriority", player: casting.player }),
    events: [{ type: "CAST_CANCELLED", player: casting.player, cardId: casting.card.cardId }],
  };
}

export function castingOf(state: GameState): Casting {
  if (state.casting === null) throw new Error("No spell is being cast");
  return state.casting;
}
