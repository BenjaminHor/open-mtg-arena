// The steps shared by casting a spell (CR 601.2c, 601.2f–i) and activating an ability (CR 602.2b): targets and their
// division (`choose-targets.ts`), paying the cost, and cancelling. Progress is kept in `GameState.casting` and on the
// stack object, so every pause is plain data and a cancelled action can be reversed exactly (CR 734.1, D-035). Modes
// come later (later: CR 700.2).

import { cardDataOf } from "../cards/card-data.ts";
import type { CardDatabase, Color, ManaCost } from "../cards/types.ts";
import { resolveManaAbility } from "../mana/activate.ts";
import { autoPay, manaAvailable } from "../mana/auto-pay.ts";
import { type ManaPayment, manaValue, payFromPool } from "../mana/payment.ts";
import { happen } from "../pipeline/happen.ts";
import type { SingleEvent } from "../pipeline/proposed.ts";
import { controllerOf } from "../rules/controller.ts";
import { announcesX, costIncreases, costOf, withX } from "../rules/costs.ts";
import { revealedBy } from "../rules/revealed.ts";
import type { Casting } from "../state/casting.ts";
import type { GameEvent } from "../state/events.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { AbilityRef, GameObject } from "../state/objects.ts";
import { detectTriggers } from "../triggers/detect.ts";
import { removeAbilityFromStack } from "../zones/stack-abilities.ts";
import { withZoneList, zoneList } from "../zones/zone-list.ts";
import { countActivation } from "./activation-count.ts";
import { castingOf } from "./casting-state.ts";
import { targetStep } from "./choose-targets.ts";
import { counterPayments } from "./counter-costs.ts";
import { waitFor } from "./decide.ts";
import { loyaltyPayment, loyaltyXMost } from "./loyalty-abilities.ts";
import type { Progress } from "./progress.ts";
import { sacrificeParts, sacrificesStillPossible, selfSacrificesForCost } from "./sacrifice-costs.ts";
import { canTapForCost, tapsForCost } from "./tap-costs.ts";
import { queueWork } from "./work.ts";

/**
 * The next decision: the value of X (CR 601.2b), targets and their division (CR 601.2c–d), then, with the total cost
 * locked in (CR 601.2f), what to sacrifice for it and the mana (CR 601.2g–h). A cost with no mana in it is paid as soon
 * as its other choices are made.
 */
export function nextCastingStep(state: GameState, cards: CardDatabase): Progress {
  const casting = castingOf(state);
  const obj = state.objects[casting.object];
  if (obj?.choices?.x === null && announcesX(state, casting.object, cards)) {
    const available = manaAvailable(state, casting.player, cards);
    // [−X]: at most the loyalty counters there are (CR 606.6); {X}: what the mana could pay.
    const upTo =
      loyaltyXMost(state, cards) ??
      payableX(state, casting.object, Math.max(0, available - manaValue(castingCost(state, casting, cards))), cards);
    return wait(waitFor(state, casting.player, { kind: "announceX", object: casting.object, upTo }));
  }
  const targeted = targetStep(state, cards);
  if (targeted.pending !== null) return wait(targeted);
  // A triggered ability has nothing to pay: with its targets chosen, it's on the stack, and the rest of its batch goes
  // on (CR 603.3d, 603.3b).
  if (casting.origin.kind === "trigger") {
    const { batch, priorityTo } = casting.origin;
    return wait(queueWork({ ...targeted, casting: null }, { kind: "putTriggers", batch, player: priorityTo }));
  }
  if (casting.sacrifices.length < sacrificeParts(targeted, casting.object, cards).length) {
    return wait(waitFor(targeted, casting.player, { kind: "chooseSacrifice", object: casting.object }));
  }
  const cost = castingCost(targeted, casting, cards);
  if (cost.length === 0) {
    const paid = payCost(targeted, cost, { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, cards);
    if (typeof paid === "string") throw new Error(paid);
    return paid;
  }
  return wait(waitFor(targeted, casting.player, { kind: "payMana", object: casting.object, cost }));
}

/**
 * What a cast or activation keeps of the game as it begins: the triggered abilities already waiting, which a cancel
 * leaves waiting, and each library's top card, so a new one stays unrevealed until the spell is cast (CR 401.5).
 */
export function castingBegins(state: GameState): Pick<Casting, "triggersBefore" | "libraryTops"> {
  const libraryTops: Record<PlayerId, ObjectId | null> = {};
  for (const p of state.turnOrder) libraryTops[p] = state.zones.players[p]?.library[0] ?? null;
  return { triggersBefore: state.pendingTriggers, libraryTops };
}

/**
 * What's paid: the spell's or ability's cost (CR 601.2f), or for a spell cast "without paying its mana cost" only its
 * cost increases (CR 118.9, 118.9d).
 */
function castingCost(state: GameState, casting: Casting, cards: CardDatabase): ManaCost {
  return casting.origin.kind === "resolution"
    ? costIncreases(state, casting.object, cards)
    : costOf(state, casting.object, cards);
}

function wait(state: GameState): Progress {
  return { state, events: [] };
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
  color?: Color,
): Progress {
  const casting = castingOf(state);
  const pending = state.pending;
  if (pending?.kind !== "payMana") throw new Error("Not paying a cost");
  const resolved = resolveManaAbility({ ...state, pending: null }, casting.player, object, ability, cards, color);
  const tapped = resolved.events.flatMap((e) => (e.type === "PERMANENT_TAPPED" ? [e.object] : []));
  const next = { ...resolved.state, casting: { ...casting, tappedForMana: [...casting.tappedForMana, ...tapped] } };
  return {
    state: waitFor(next, casting.player, { kind: "payMana", object: pending.object, cost: pending.cost }),
    events: resolved.events,
  };
}

/**
 * CR 601.2h: the player pays the whole cost at once, after any mana abilities (CR 601.2g): the mana from their pool,
 * then the loyalty counters (CR 606.4), the {T} and the sacrifices chosen, which must all still be possible, since partial payments aren't allowed and
 * unpayable costs can't be paid. Then the spell becomes cast (CR 601.2i) or the ability activated (CR 602.2b), so the
 * cost's events come first. They receive priority (CR 117.3c), and everyone has to pass again (CR 117.4).
 */
export function payCost(
  state: GameState,
  cost: ManaCost,
  payment: ManaPayment,
  cards: CardDatabase,
): Progress | string {
  const casting = castingOf(state);
  const ps = state.players[casting.player];
  if (ps === undefined) throw new Error(`No player ${casting.player}`);
  const rest = payFromPool(ps.manaPool, cost, payment);
  if (rest === null) return "that payment doesn't pay the cost (CR 601.2h)";
  if (!sacrificesStillPossible(state, cards))
    return "a permanent chosen to sacrifice can't be sacrificed now (CR 601.2h)";
  const taps = tapsForCost(state, cards);
  if (!taps.every((id) => canTapForCost(state, id)))
    return "a permanent to tap for the cost is tapped or gone (CR 107.5, 601.2h)";
  const selfSacrifices = selfSacrificesForCost(state, cards);
  if (
    !selfSacrifices.every(
      (id) => state.zones.battlefield.includes(id) && controllerOf(state, id, cards) === casting.player,
    )
  )
    return "the permanent to sacrifice for the cost is gone or no longer the player's (CR 601.2h, 701.21a)";
  const loyalty = loyaltyPayment(state, cards);
  if (loyalty === "unpayable") return "the loyalty counters to remove for the cost aren't there (CR 601.2h, 606.6)";
  const counters = counterPayments(state, cards);
  if (counters === "unpayable") return "the counters to remove for the cost aren't there (CR 118.3, 601.2h)";
  const obj = state.objects[casting.object];
  if (obj === undefined) throw new Error("Nothing is being put on the stack");
  const players = { ...state.players, [casting.player]: { ...ps, manaPool: rest } };
  // Loyalty counters, then taps, then sacrifices: "{T}, Sacrifice this" taps it before it's gone (CR 601.2h lets the
  // order be chosen).
  const costs: SingleEvent[] = [
    ...(loyalty === null ? [] : [loyalty]),
    ...counters,
    ...taps.map((object) => ({ kind: "tap", object }) as const),
    ...[...selfSacrifices, ...casting.sacrifices].map((object) => ({ kind: "sacrifice", object }) as const),
  ];
  const paid = happen({ ...state, players }, { kind: "simultaneous", events: costs }, cards);
  const finished: GameState = { ...paid.state, casting: null, passesInSuccession: 0 };
  // An activated ability counts as activated now, whether or not it resolves (D-078).
  const done =
    obj.kind === "ability" && obj.ability.kind === "printed"
      ? countActivation(finished, obj.source, obj.ability.index)
      : finished;
  const event = becameCastOrActivated(casting.player, obj);
  // "Whenever a player casts ..." triggers now, so it goes on the stack above the spell (CR 601.2i). Only this event:
  // the costs' events were matched as they went through `happen`.
  const triggered = detectTriggers(done, done, [event], cards);
  const shown = newTopsShown(triggered, casting, cards);
  // A spell cast while something resolves gives no one priority: the resolution goes on (CR 608.2g).
  const after =
    casting.origin.kind === "resolution"
      ? shown.state
      : queueWork(shown.state, { kind: "givePriority", player: casting.player });
  return { state: after, events: [...paid.events, event, ...shown.events] };
}

/**
 * A revealed library's new top card, held back while the spell was being cast, is revealed once it's cast (CR 401.5):
 * the cast moved the card on top to the stack (Djinn of Wishes with Vampire Nocturnus).
 */
function newTopsShown(state: GameState, casting: Casting, cards: CardDatabase): Progress {
  const reveals = revealedBy(state, cards).tops.flatMap((player): SingleEvent[] => {
    const top = state.zones.players[player]?.library[0];
    return top === undefined || top === casting.libraryTops[player]
      ? []
      : [{ kind: "reveal", from: { zone: "library", player }, objects: [top] }];
  });
  return reveals.length === 0 ? { state, events: [] } : happen(state, { kind: "simultaneous", events: reveals }, cards);
}

/**
 * The player cancels: the whole action is reversed (CR 734.1). A spell's card returns to where it was in the hand as the
 * same object; an ability ceases to exist. The pool is as it was, and permanents tapped for mana during it untap;
 * nothing triggers. The player keeps priority (CR 734.2), and the passes don't restart: nothing was done.
 */
export function cancelCasting(state: GameState): Progress {
  const casting = castingOf(state);
  // Triggers waiting now that weren't as it began came from it (its mana abilities, its targets becoming targets), and
  // nothing triggers from a reversed action (CR 734.1). From priority none were waiting (CR 117.5); a cast during a
  // resolution (CR 608.2g) keeps those that were. Delayed triggers aren't restored: they can't trigger during a cast
  // while they wait only for the beginning of a step (future-rules).
  let next = untapAndRestorePool({ ...state, casting: null, pendingTriggers: casting.triggersBefore }, casting);
  let event: GameEvent;
  switch (casting.origin.kind) {
    case "card": {
      const { card, handIndex } = casting.origin;
      const spell = next.objects[casting.object];
      if (spell?.kind !== "card") throw new Error(`${casting.object} isn't a spell`);
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
        // The spell's card id, which everyone saw on the stack, not the restored card's, which is hidden (D-054).
        cardId: spell.cardId,
        spell: casting.object,
        restored: card.id,
        untapped: casting.tappedForMana,
      };
      break;
    }
    case "resolution": {
      // Back on top of the library it came from, as the same object; the resolution goes on, and no one gets
      // priority (CR 608.2g), so "if you don't, exile it" finds it there.
      const { card, library } = casting.origin;
      const spell = next.objects[casting.object];
      if (spell?.kind !== "card") throw new Error(`${casting.object} isn't a spell`);
      const { [casting.object]: _spell, ...rest } = next.objects;
      next = { ...next, objects: { ...rest, [card.id]: card } };
      next = withZoneList(
        next,
        { zone: "stack" },
        next.zones.stack.filter((id) => id !== casting.object),
      );
      const ref = { zone: "library", player: library } as const;
      next = withZoneList(next, ref, [card.id, ...zoneList(next, ref)]);
      const cancelled: GameEvent = {
        type: "CAST_CANCELLED",
        player: casting.player,
        cardId: spell.cardId,
        spell: casting.object,
        // No one sees into a library, not even its owner (CR 401.2).
        restored: null,
        untapped: casting.tappedForMana,
      };
      return { state: next, events: [cancelled] };
    }
    case "trigger":
      throw new Error("a triggered ability being put on the stack can't be cancelled (CR 603.3d)");
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

/** CR 601.2i: the spell becomes cast; CR 602.2b: the ability becomes activated. */
function becameCastOrActivated(player: PlayerId, obj: GameObject): GameEvent {
  switch (obj.kind) {
    case "card":
      return { type: "SPELL_CAST", player, object: obj.id, cardId: obj.cardId };
    case "ability":
      return { type: "ABILITY_ACTIVATED", player, object: obj.id, source: obj.source };
  }
}

/**
 * Why this value of X can't be announced, or null: a whole number (CR 107.1a), not negative (CR 107.1b), as the caster
 * chooses (CR 107.3a).
 */
export function xProblem(value: number): string | null {
  // A safe integer, so the state stays exact as JSON.
  return Number.isSafeInteger(value) && value >= 0 ? null : "X is a whole number from 0 (CR 107.1a, 107.1b, 107.3a)";
}

/** The player announces X; it's kept on the spell or ability (CR 107.3a). The casting steps then go on. */
export function announceX(state: GameState, value: number): GameState {
  const casting = castingOf(state);
  const obj = state.objects[casting.object];
  if (obj === undefined || obj.choices === null) throw new Error("Nothing is being put on the stack");
  const choices = { ...obj.choices, x: value };
  return { ...state, objects: { ...state.objects, [casting.object]: { ...obj, choices } } };
}

/**
 * `upTo` lowered, for "spend only black mana on X" (`xPaidWith`), to the largest X whose cost the player could pay
 * now, so the X offered stays a guide to what's payable (D-058, D-067). Other spells' X is limited by mana alone.
 * Auto pay taps only sources that make one mana, so a black source making more (none in the pool yet) would be
 * undercounted here: `autoPay` should learn to use them when one arrives.
 */
function payableX(state: GameState, id: ObjectId, upTo: number, cards: CardDatabase): number {
  const obj = state.objects[id];
  const data = obj?.kind === "card" ? cardDataOf(obj, cards) : undefined;
  const color = data?.def.spell?.xPaidWith;
  const printed = data?.printed.manaCost ?? null;
  if (color === undefined || printed === null) return upTo;
  const player = castingOf(state).player;
  let x = upTo;
  while (x > 0 && autoPay(state, player, withX(printed, x, color), cards) === null) x--;
  return x;
}
