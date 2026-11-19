// Who may see the cards in a zone. The one place both views and event filtering decide visibility, so face-down cards
// and reveals (docs/future-rules.md, "Hidden information beyond hands and libraries") change one function.

import type { PlayerId } from "../state/ids.ts";
import type { ZoneRef } from "../state/zones.ts";

/**
 * Whether `viewer` sees the cards in this zone: public zones (CR 400.2) and their own hand (CR 402.3). Not libraries,
 * not even their own (CR 401.2).
 */
export function canSee(zone: ZoneRef, viewer: PlayerId): boolean {
  switch (zone.zone) {
    case "library":
      return false;
    case "hand":
      return zone.player === viewer;
    case "graveyard":
    case "battlefield":
    case "stack":
    case "exile":
    case "command":
      return true;
  }
}
