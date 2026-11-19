// Giving a player priority (CR 117). Every place that gives priority calls `givePriority`, so the checks that come
// first (state-based actions, CR 704.3, and putting triggered abilities on the stack, CR 117.5) can be added here
// in M1-07 and M1-12.

import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";
import { waitFor } from "./decide.ts";

export function givePriority(state: GameState, player: PlayerId): GameState {
  return waitFor(state, player, { kind: "priority" });
}
