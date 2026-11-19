// Discarding cards (CR 701.9a): they move from their owner's hand to their graveyard.

import { andThen, type Progress } from "../game/progress.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { moveCard } from "./move-card.ts";

/**
 * Discards these cards as one action. Emits `CARD_DISCARDED` for each, as well as its zone change, so "whenever a
 * player discards" triggers can see them.
 */
export function discardCards(state: GameState, player: PlayerId, ids: readonly ObjectId[]): Progress {
  let progress: Progress = { state, events: [] };
  for (const id of ids) {
    const card = progress.state.objects[id];
    if (card?.kind !== "card") throw new Error(`${id} isn't a card`);
    progress = andThen(progress, (s) => {
      const moved = moveCard(s, id, { zone: "graveyard" });
      return {
        state: moved.state,
        events: [...moved.events, { type: "CARD_DISCARDED", player, newId: moved.newId, cardId: card.cardId }],
      };
    });
  }
  return progress;
}
