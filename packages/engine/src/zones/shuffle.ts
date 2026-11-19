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
  const cards = [...zoneList(state, ref)];
  let rng = state.rng;
  for (let i = cards.length - 1; i > 0; i--) {
    const pick = randomInt(rng, i + 1);
    rng = pick.rng;
    const j = pick.value;
    [cards[i], cards[j]] = [cards[j] as (typeof cards)[number], cards[i] as (typeof cards)[number]];
  }
  return { state: withZoneList({ ...state, rng }, ref, cards), events: [{ type: "LIBRARY_SHUFFLED", player }] };
}
