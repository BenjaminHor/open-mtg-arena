// Putting a library's top cards back in a chosen order (CR 401.4: "Look at the top three cards of your library, then put
// them back in any order"). The cards keep their ids; looked-at cards that are reordered become new objects
// (later: CR 701.20d), which matters only once something tracks a card that was looked at.

import type { Progress } from "../game/progress.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { withZoneList, zoneList } from "./zone-list.ts";

/**
 * `top` goes on top of `player`'s library in that order, top first, above the rest, and `bottom` under the rest, top
 * first too. No event: the order is hidden (CR 401.2), and nothing triggers on it.
 */
export function reorderLibraryTop(
  state: GameState,
  player: PlayerId,
  top: readonly ObjectId[],
  bottom: readonly ObjectId[] = [],
): Progress {
  const ref = { zone: "library", player } as const;
  const library = zoneList(state, ref);
  const onTop = top.filter((id) => library.includes(id));
  const below = bottom.filter((id) => library.includes(id) && !onTop.includes(id));
  const rest = library.filter((id) => !onTop.includes(id) && !below.includes(id));
  return { state: withZoneList(state, ref, [...onTop, ...rest, ...below]), events: [] };
}
