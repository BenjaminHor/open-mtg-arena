// Putting a library's top cards back in a chosen order (CR 401.4: "Look at the top three cards of your library, then put
// them back in any order"). Nothing leaves the library, so nothing becomes a new object (CR 400.7).

import type { Progress } from "../game/progress.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { withZoneList, zoneList } from "./zone-list.ts";

/**
 * `top` goes on top of `player`'s library in that order, top first, above the rest. No event: the order is hidden
 * (CR 401.2), and nothing triggers on it.
 */
export function reorderLibraryTop(state: GameState, player: PlayerId, top: readonly ObjectId[]): Progress {
  const ref = { zone: "library", player } as const;
  const library = zoneList(state, ref);
  const kept = top.filter((id) => library.includes(id));
  const rest = library.filter((id) => !kept.includes(id));
  return { state: withZoneList(state, ref, [...kept, ...rest]), events: [] };
}
