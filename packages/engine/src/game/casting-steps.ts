// The steps shared by casting a spell (CR 601.2b–i) and activating an ability (CR 602.2b): choosing targets, paying the
// cost, and cancelling. Progress is kept in `GameState.casting` and on the stack object, so every pause is plain data
// and a cancelled action can be reversed exactly (CR 734.1, D-035).

import type { CardDatabase, ManaCost } from "../cards/types.ts";
import { resolveManaAbility } from "../mana/activate.ts";
import { type ManaPayment, payFromPool } from "../mana/payment.ts";
import { stackAbilityDef } from "../rules/abilities.ts";
import { activationManaCost, totalCost } from "../rules/costs.ts";
import { isLegalTarget, targetSpecsOf } from "../rules/targets.ts";
import type { Casting } from "../state/casting.ts";
import type { GameEvent } from "../state/events.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import type { AbilityRef, Target } from "../state/objects.ts";
import { removeAbilityFromStack } from "../zones/stack-abilities.ts";
import { withZoneList, zoneList } from "../zones/zone-list.ts";
import { waitFor } from "./decide.ts";
import type { Progress } from "./progress.ts";
import { queueWork } from "./work.ts";

/** The next decision: the next target (CR 601.2c), then paying the cost (CR 601.2g–h). */
export function nextCastingStep(state: GameState, cards: CardDatabase): GameState {
  const casting = castingOf(state);
  const obj = state.objects[casting.object];
  if (obj === undefined || obj.choices === null) throw new Error("Nothing is being put on the stack");
  const chosen = obj.choices.targets.length;
  if (chosen < targetSpecsOf(state, casting.object, cards).length) {
    return waitFor(state, casting.player, { kind: "chooseTarget", object: casting.object, instance: chosen });
  }
  return waitFor(state, casting.player, { kind: "payMana", object: casting.object, cost: costToPay(state, cards) });
}

/** The mana to pay: a spell's total cost (CR 601.2f), or an ability's activation cost (CR 602.2b). */
function costToPay(state: GameState, cards: CardDatabase): ManaCost {
  const casting = castingOf(state);
  switch (casting.origin.kind) {
    case "card":
      return totalCost(state, casting.object, cards) ?? [];
    case "ability":
      return activationManaCost(stackAbilityDef(state, casting.object, cards));
  }
}

/** Why this target can't be chosen for the pending instance, or null. */
export function targetProblem(state: GameState, instance: number, target: Target, cards: CardDatabase): string | null {
  const spec = targetSpecsOf(state, castingOf(state).object, cards)[instance];
  if (spec === undefined || !isLegalTarget(state, spec, target, cards)) return "that isn't a legal target (CR 115)";
  return null;
}

export function chooseTarget(state: GameState, target: Target, cards: CardDatabase): Progress {
  const id = castingOf(state).object;
  const obj = state.objects[id];
  if (obj === undefined || obj.choices === null) throw new Error("Nothing is being put on the stack");
  const choices = { ...obj.choices, targets: [...obj.choices.targets, [target]] };
  const next = { ...state, objects: { ...state.objects, [id]: { ...obj, choices } } };
  return { state: nextCastingStep(next, cards), events: [] };
}

/**
 * While paying, the player activates a mana ability (CR 605.3a, 601.2g). It resolves at once; the payment decision is
 * asked again with the new mana in the pool. A permanent tapped for it untaps if the action is reversed.
 */
export function activateWhilePaying(
  state: GameState,
  object: ObjectId,
  ability: AbilityRef,
  cards: CardDatabase,
): Progress {
  const casting = castingOf(state);
  const pending = state.pending;
  if (pending?.kind !== "payMana") throw new Error("Not paying a cost");
  const resolved = resolveManaAbility({ ...state, pending: null }, casting.player, object, ability, cards);
  const tapped = resolved.events.flatMap((e) => (e.type === "PERMANENT_TAPPED" ? [e.object] : []));
  const next = { ...resolved.state, casting: { ...casting, tappedForMana: [...casting.tappedForMana, ...tapped] } };
  return {
    state: waitFor(next, casting.player, { kind: "payMana", object: pending.object, cost: pending.cost }),
    events: resolved.events,
  };
}

/**
 * CR 601.2h: the player pays the cost in full from their pool; then the spell becomes cast (CR 601.2i) or the ability
 * activated (CR 602.2b). They receive priority (CR 117.3c), and everyone has to pass again (CR 117.4).
 */
export function payCost(state: GameState, cost: ManaCost, payment: ManaPayment): Progress | string {
  const casting = castingOf(state);
  const ps = state.players[casting.player];
  if (ps === undefined) throw new Error(`No player ${casting.player}`);
  const rest = payFromPool(ps.manaPool, cost, payment);
  if (rest === null) return "that payment doesn't pay the cost (CR 601.2h)";
  const obj = state.objects[casting.object];
  if (obj === undefined) throw new Error("Nothing is being put on the stack");
  const players = { ...state.players, [casting.player]: { ...ps, manaPool: rest } };
  const done: GameState = { ...state, players, casting: null, passesInSuccession: 0 };
  const event: GameEvent =
    obj.kind === "card"
      ? { type: "SPELL_CAST", player: casting.player, object: casting.object, cardId: obj.cardId }
      : { type: "ABILITY_ACTIVATED", player: casting.player, object: casting.object, source: obj.source };
  return { state: queueWork(done, { kind: "givePriority", player: casting.player }), events: [event] };
}

/**
 * The player cancels: the whole action is reversed (CR 734.1). A spell's card returns to where it was in the hand as the
 * same object; an ability ceases to exist. The pool is as it was, and permanents tapped for mana during it untap;
 * nothing triggers. The player keeps priority (CR 734.2), and the passes don't restart: nothing was done.
 */
export function cancelCasting(state: GameState): Progress {
  const casting = castingOf(state);
  let next = untapAndRestorePool({ ...state, casting: null }, casting);
  let event: GameEvent;
  switch (casting.origin.kind) {
    case "card": {
      const { card, handIndex } = casting.origin;
      const { [casting.object]: _spell, ...rest } = next.objects;
      next = { ...next, objects: { ...rest, [card.id]: card } };
      next = withZoneList(
        next,
        { zone: "stack" },
        next.zones.stack.filter((id) => id !== casting.object),
      );
      const hand = [...zoneList(next, { zone: "hand", player: casting.player })];
      hand.splice(handIndex, 0, card.id);
      next = withZoneList(next, { zone: "hand", player: casting.player }, hand);
      event = {
        type: "CAST_CANCELLED",
        player: casting.player,
        cardId: card.cardId,
        spell: casting.object,
        restored: card.id,
        untapped: casting.tappedForMana,
      };
      break;
    }
    case "ability":
      next = removeAbilityFromStack(next, casting.object);
      event = {
        type: "ACTIVATION_CANCELLED",
        player: casting.player,
        object: casting.object,
        source: casting.origin.source,
        untapped: casting.tappedForMana,
      };
      break;
  }
  return { state: queueWork(next, { kind: "givePriority", player: casting.player }), events: [event] };
}

function untapAndRestorePool(state: GameState, casting: Casting): GameState {
  const objects = { ...state.objects };
  for (const id of casting.tappedForMana) {
    const obj = objects[id];
    if (obj?.kind === "card") objects[id] = { ...obj, tapped: false };
  }
  const ps = state.players[casting.player];
  const players =
    ps === undefined ? state.players : { ...state.players, [casting.player]: { ...ps, manaPool: casting.poolBefore } };
  return { ...state, objects, players };
}

export function castingOf(state: GameState): Casting {
  if (state.casting === null) throw new Error("Nothing is being cast or activated");
  return state.casting;
}
