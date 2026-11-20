// Which triggered abilities an event triggers (CR 603.2): matched as the event happens, waiting in
// `GameState.pendingTriggers` until a player would receive priority (CR 603.3). Only permanents' abilities trigger
// (CR 113.6): a card in a graveyard or a spell on the stack doesn't.

import type { TriggerCheck, TriggerCondition } from "../cards/triggers.ts";
import type { CardDatabase } from "../cards/types.ts";
import { triggersOf } from "../rules/abilities.ts";
import { controllerOf } from "../rules/controller.ts";
import { matchesFilter } from "../rules/object-filter.ts";
import type { GameEvent } from "../state/events.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import type { PendingTrigger, TriggerEvent } from "../state/triggers.ts";

/**
 * Adds the triggered abilities these events trigger to the pending list, in the order they triggered. `before` is the
 * state before the events, for abilities that look back in time (later: CR 603.10); `after`, the state right after,
 * which entering abilities check (CR 603.6a: a permanent entering at the same time sees the others).
 */
export function detectTriggers(
  _before: GameState,
  after: GameState,
  events: readonly GameEvent[],
  cards: CardDatabase,
): GameState {
  const sources = after.zones.battlefield.filter((id) => triggersOf(after, id, cards).length > 0);
  if (sources.length === 0) return after;
  const found = events.flatMap((event) => sources.flatMap((source) => triggered(after, source, event, cards)));
  return found.length === 0 ? after : { ...after, pendingTriggers: [...after.pendingTriggers, ...found] };
}

/** The triggers of one permanent this event triggers. */
function triggered(state: GameState, source: ObjectId, event: GameEvent, cards: CardDatabase): PendingTrigger[] {
  const obj = state.objects[source];
  if (obj?.kind !== "card") return [];
  const controller = controllerOf(state, source);
  return triggersOf(state, source, cards).flatMap(({ index, def }) => {
    const matched = matches(state, source, def.when, event, cards);
    if (matched === null) return [];
    // An "intervening if" that's false as the event happens means it doesn't trigger at all (CR 603.4).
    if (def.onlyIf !== undefined && !holds(state, source, def.onlyIf)) return [];
    return [{ source, sourceOracleId: obj.oracleId, index, controller, event: matched }];
  });
}

/** What the ability knows of the event, if the event matches its trigger condition; null if it doesn't. */
function matches(
  state: GameState,
  source: ObjectId,
  when: TriggerCondition,
  event: GameEvent,
  cards: CardDatabase,
): TriggerEvent | null {
  switch (when.kind) {
    case "selfEnters":
      return entered(event) === source ? { player: null, object: source } : null;
    case "anotherEnters": {
      const object = entered(event);
      if (object === null || object === source) return null;
      return matchesFilter(state, object, when.filter, controllerOf(state, source), cards)
        ? { player: null, object }
        : null;
    }
    case "beginningOfStep":
      // "Each player's draw step": "that player", in the card's text, is the player whose step it is.
      return event.type === "STEP_BEGAN" && event.step === when.step
        ? { player: event.activePlayer, object: null }
        : null;
    case "selfAttacks":
      return event.type === "ATTACKERS_DECLARED" && event.attacks.some((a) => a.attacker === source)
        ? { player: null, object: source }
        : null;
  }
}

/** The permanent an event put onto the battlefield, or null (CR 603.6a). */
function entered(event: GameEvent): ObjectId | null {
  return event.type === "ZONE_CHANGED" && event.to.zone === "battlefield" ? event.newId : null;
}

/**
 * Whether an "intervening if" condition holds now (CR 603.4), as the ability triggers and again as it resolves
 * (CR 608.2a).
 */
export function holds(state: GameState, source: ObjectId, check: TriggerCheck): boolean {
  switch (check.kind) {
    case "sourceUntapped": {
      // A source that's gone is read as it last existed (CR 608.2h).
      const obj = state.objects[source] ?? state.lastKnown[source];
      return obj?.kind === "card" && !obj.tapped;
    }
  }
}
