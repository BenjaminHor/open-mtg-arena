// Drawing a card (CR 121): the top card of the library goes to its owner's hand.

import { andThen, type Progress } from "../game/progress.ts";
import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";
import { moveCard } from "./move-card.ts";
import { zoneList } from "./zone-list.ts";

/**
 * Emits `CARD_DRAWN` as well as the zone change, so "whenever you draw" triggers and the UI can tell a draw from
 * other ways a card reaches the hand.
 */
export function drawCard(state: GameState, player: PlayerId): Progress {
  const top = zoneList(state, { zone: "library", player })[0];
  // Drawing from an empty library makes the player lose (CR 704.5b), which arrives in M1-12. Until then, fail loudly.
  if (top === undefined) throw new Error(`${player} would draw from an empty library (CR 704.5b, not built yet)`);
  const card = state.objects[top];
  if (card?.kind !== "card") throw new Error(`${top} in a library isn't a card`);
  const moved = moveCard(state, top, { zone: "hand" });
  const drawn = { type: "CARD_DRAWN", player, newId: moved.newId, cardId: card.cardId } as const;
  return { state: moved.state, events: [...moved.events, drawn] };
}

export function drawCards(state: GameState, player: PlayerId, count: number): Progress {
  let progress: Progress = { state, events: [] };
  for (let i = 0; i < count; i++) progress = andThen(progress, (s) => drawCard(s, player));
  return progress;
}
