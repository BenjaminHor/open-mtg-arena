// Where a card went. A zone change makes a new object (CR 400.7), and the code that proposed the move often needs it
// (the spell being cast, the land just played). It reads the `ZONE_CHANGED` event, not the proposal: a replacement
// effect may send the card somewhere else (CR 614.6), or nowhere.

import type { GameEvent } from "../state/events.ts";
import type { ObjectId } from "../state/ids.ts";

export type ZoneChanged = Extract<GameEvent, { type: "ZONE_CHANGED" }>;

/** The zone change of the object that was `oldId`, or null if it didn't move. */
export function zoneChangeOf(events: readonly GameEvent[], oldId: ObjectId): ZoneChanged | null {
  for (const event of events) if (event.type === "ZONE_CHANGED" && event.oldId === oldId) return event;
  return null;
}
