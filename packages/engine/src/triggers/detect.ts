// Which triggered abilities an event triggers (CR 603.2): matched as the event happens, waiting in
// `GameState.pendingTriggers` until a player would receive priority (CR 603.3). Only permanents' abilities trigger
// (CR 113.6): a card in a graveyard or a spell on the stack doesn't.

import type { CardDatabase } from "../cards/types.ts";
import { triggersOf } from "../rules/abilities.ts";
import { controllerOf } from "../rules/controller.ts";
import type { GameEvent } from "../state/events.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import type { PendingTrigger } from "../state/triggers.ts";
import { detectDelayed } from "./delayed.ts";
import { holds, matches } from "./match-event.ts";

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
  // Delayed triggers are matched apart from the battlefield's: no permanent has them. Their order in the batch doesn't
  // matter, as each player orders their own triggers as they go on the stack (CR 603.3b).
  const withDelayed = detectDelayed(after, events, cards);
  const sources = after.zones.battlefield.filter((id) => triggersOf(after, id, cards).length > 0);
  if (sources.length === 0) return withDelayed;
  const found = events.flatMap((event) => sources.flatMap((source) => triggered(after, source, event, cards)));
  return found.length === 0
    ? withDelayed
    : { ...withDelayed, pendingTriggers: [...withDelayed.pendingTriggers, ...found] };
}

/** The triggers of one permanent this event triggers. */
function triggered(state: GameState, source: ObjectId, event: GameEvent, cards: CardDatabase): PendingTrigger[] {
  const obj = state.objects[source];
  if (obj?.kind !== "card") return [];
  const controller = controllerOf(state, source);
  return triggersOf(state, source, cards).flatMap(({ index, def }) => {
    const occurrences = matches(state, source, def.when, event, cards);
    if (occurrences.length === 0) return [];
    // An "intervening if" that's false as the event happens means it doesn't trigger at all (CR 603.4).
    if (def.onlyIf !== undefined && !holds(state, source, def.onlyIf)) return [];
    const ref = { kind: "triggered", index } as const;
    return occurrences.map((matched) => ({ source, sourceOracleId: obj.oracleId, ref, controller, event: matched }));
  });
}
