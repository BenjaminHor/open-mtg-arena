// The steps shared by casting a spell (CR 601.2c, 601.2f–i) and activating an ability (CR 602.2b): targets and their
// division (`choose-targets.ts`), paying the cost, and cancelling. Progress is kept in `GameState.casting` and on the
// stack object, so every pause is plain data and a cancelled action can be reversed exactly (CR 734.1, D-035). Modes
// come later (later: CR 700.2).

import type { CardDatabase, ManaCost } from "../cards/types.ts";
import { resolveManaAbility } from "../mana/activate.ts";
import { manaAvailable } from "../mana/auto-pay.ts";
import { type ManaPayment, manaValue, payFromPool } from "../mana/payment.ts";
import { happen } from "../pipeline/happen.ts";
import type { SingleEvent } from "../pipeline/proposed.ts";
import { controllerOf } from "../rules/controller.ts";
import { announcesX, costOf } from "../rules/costs.ts";
import type { Casting } from "../state/casting.ts";
import type { GameEvent } from "../state/events.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { AbilityRef, GameObject } from "../state/objects.ts";
import { removeAbilityFromStack } from "../zones/stack-abilities.ts";
import { withZoneList, zoneList } from "../zones/zone-list.ts";
import { castingOf } from "./casting-state.ts";
import { targetStep } from "./choose-targets.ts";
import { waitFor } from "./decide.ts";
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
    const upTo = Math.max(0, available - manaValue(costOf(state, casting.object, cards)));
    return wait(waitFor(state, casting.player, { kind: "announceX", object: casting.object, upTo }));
  }
  const targeted = targetStep(state, cards);
  if (targeted.pending !== null) return wait(targeted);
  if (casting.sacrifices.length < sacrificeParts(targeted, casting.object, cards).length) {
    return wait(waitFor(targeted, casting.player, { kind: "chooseSacrifice", object: casting.object }));
  }
  const cost = costOf(targeted, casting.object, cards);
  if (cost.length === 0) {
    const paid = payCost(targeted, cost, { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, cards);
    if (typeof paid === "string") throw new Error(paid);
    return paid;
  }
  return wait(waitFor(targeted, casting.player, { kind: "payMana", object: casting.object, cost }));
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
 * CR 601.2h: the player pays the whole cost at once, after any mana abilities (CR 601.2g): the mana from their pool,
 * then the {T} and the sacrifices chosen, which must all still be possible, since partial payments aren't allowed and
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
  if (!selfSacrifices.every((id) => state.zones.battlefield.includes(id) && controllerOf(state, id) === casting.player))
    return "the permanent to sacrifice for the cost is gone or no longer the player's (CR 601.2h, 701.21a)";
  const obj = state.objects[casting.object];
  if (obj === undefined) throw new Error("Nothing is being put on the stack");
  const players = { ...state.players, [casting.player]: { ...ps, manaPool: rest } };
  // Taps first, then sacrifices: "{T}, Sacrifice this" taps it before it's gone (CR 601.2h lets the order be chosen).
  const costs: SingleEvent[] = [
    ...taps.map((object) => ({ kind: "tap", object }) as const),
    ...[...selfSacrifices, ...casting.sacrifices].map((object) => ({ kind: "sacrifice", object }) as const),
  ];
  const paid = happen({ ...state, players }, { kind: "simultaneous", events: costs }, cards);
  const done: GameState = { ...paid.state, casting: null, passesInSuccession: 0 };
  const event = becameCastOrActivated(casting.player, obj);
  return {
    state: queueWork(done, { kind: "givePriority", player: casting.player }),
    events: [...paid.events, event],
  };
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
