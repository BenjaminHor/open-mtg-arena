// Shuffling a library (CR 701.24a): a uniformly random order, from the game's seeded RNG.

import type { Progress } from "../game/progress.ts";
import { randomInt } from "../rng/xoshiro128.ts";
import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";
import { withZoneList, zoneList } from "./zone-list.ts";

/**
 * Fisher–Yates: for each position from the last down to the second, swap it with a random earlier-or-same position.
 * Every order is equally likely. The cards stay the same objects: shuffling doesn't change zones.
 */
export function shuffleLibrary(state: GameState, player: PlayerId): Progress {
  const ref = { zone: "library", player } as const;
  const order = [...zoneList(state, ref)];
  let rng = state.rng;
  for (let i = order.length - 1; i > 0; i--) {
    const pick = randomInt(rng, i + 1);
    rng = pick.rng;
    const j = pick.value;
    [order[i], order[j]] = [order[j] as (typeof order)[number], order[i] as (typeof order)[number]];
  }
  return { state: withZoneList({ ...state, rng }, ref, order), events: [{ type: "LIBRARY_SHUFFLED", player }] };
}
