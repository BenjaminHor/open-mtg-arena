// Drawing a card (CR 121): the top card of the library goes to its owner's hand.

import type { Progress } from "../game/progress.ts";
import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";
import { moveCard } from "./move-card.ts";
import { zoneList } from "./zone-list.ts";

export function drawCard(state: GameState, player: PlayerId): Progress {
  const top = zoneList(state, { zone: "library", player })[0];
  // Drawing from an empty library makes the player lose (CR 704.5b), which arrives in M1-12. Until then, fail loudly.
  if (top === undefined) throw new Error(`${player} would draw from an empty library (CR 704.5b, not built yet)`);
  return moveCard(state, top, { zone: "hand", position: "top" });
}

export function drawCards(state: GameState, player: PlayerId, count: number): Progress {
  let progress: Progress = { state, events: [] };
  for (let i = 0; i < count; i++) {
    const drawn = drawCard(progress.state, player);
    progress = { state: drawn.state, events: [...progress.events, ...drawn.events] };
  }
  return progress;
}
