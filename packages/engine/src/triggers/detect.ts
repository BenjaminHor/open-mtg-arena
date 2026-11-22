// Which triggered abilities an event triggers (CR 603.2): matched as the event happens, waiting in
// `GameState.pendingTriggers` until a player would receive priority (CR 603.3). Only permanents' abilities trigger
// (CR 113.6): a card in a graveyard or a spell on the stack doesn't. A leaves-the-battlefield ability ("when this
// creature dies") looks back in time: it's found on the permanent as it was before the event (CR 603.10a).

import { textOracleId } from "../cards/card-data.ts";
import type { CardDatabase } from "../cards/types.ts";
import { triggersOf } from "../rules/abilities.ts";
import { controllerOf } from "../rules/controller.ts";
import type { GameEvent } from "../state/events.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import type { PendingTrigger } from "../state/triggers.ts";
import { detectDelayed } from "./delayed.ts";
import { holds, leavesTheBattlefield, matches } from "./match-event.ts";

/**
 * Adds the triggered abilities these events trigger to the pending list, in the order they triggered. `before` is the
 * state before the events, for abilities that look back in time (CR 603.10a); `after`, the state right after, which
 * entering abilities check (CR 603.6a: a permanent entering at the same time sees the others).
 */
export function detectTriggers(
  before: GameState,
  after: GameState,
  events: readonly GameEvent[],
  cards: CardDatabase,
): GameState {
  // Delayed triggers are matched apart from the battlefield's: no permanent has them. Their order in the batch doesn't
  // matter, as each player orders their own triggers as they go on the stack (CR 603.3b).
  const withDelayed = detectDelayed(after, events, cards);
  const sources = after.zones.battlefield.filter((id) => triggersOf(after, id, cards).length > 0);
  const found = events.flatMap((event) => [
    ...sources.flatMap((source) => triggered(after, source, event, false, cards)),
    ...lookingBack(before, event, cards),
  ]);
  return found.length === 0
    ? withDelayed
    : { ...withDelayed, pendingTriggers: [...withDelayed.pendingTriggers, ...found] };
}

/**
 * The leaves-the-battlefield triggers this event triggers: of a permanent it moved off the battlefield, read from the
 * state before it (CR 603.10a), with that controller. The ability's source is the gone permanent, known by its last
 * known information until the ability has resolved (CR 608.2h).
 */
function lookingBack(before: GameState, event: GameEvent, cards: CardDatabase): PendingTrigger[] {
  if (event.type !== "ZONE_CHANGED" || event.from.zone !== "battlefield") return [];
  if (!before.zones.battlefield.includes(event.oldId)) return [];
  return triggered(before, event.oldId, event, true, cards);
}

/** The triggers of one permanent this event triggers: those that look back in time, or the others. */
function triggered(
  state: GameState,
  source: ObjectId,
  event: GameEvent,
  looksBack: boolean,
  cards: CardDatabase,
): PendingTrigger[] {
  const obj = state.objects[source];
  if (obj?.kind !== "card") return [];
  // Its controller when it triggered (CR 603.3a): for a look-back trigger, as the permanent last was.
  const controller = controllerOf(state, source, cards);
  return triggersOf(state, source, cards).flatMap(({ index, def }) => {
    if (leavesTheBattlefield(def.when) !== looksBack) return [];
    const occurrences = matches(state, source, def.when, event, cards);
    if (occurrences.length === 0) return [];
    // An "intervening if" that's false as the event happens means it doesn't trigger at all (CR 603.4).
    if (def.onlyIf !== undefined && !holds(state, source, def.onlyIf)) return [];
    const ref = { kind: "triggered", index } as const;
    return occurrences.map((matched) => ({
      source,
      sourceOracleId: textOracleId(obj),
      ref,
      controller,
      event: matched,
    }));
  });
}
