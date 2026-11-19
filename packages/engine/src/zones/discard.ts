// Discarding cards (CR 701.9a): they move from their owner's hand to their graveyard.

import { andThen, type Progress } from "../game/progress.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import { moveCard, newCardIdOf } from "./move-card.ts";

/**
 * Discards these cards as one action. Emits `CARD_DISCARDED` for each (the discarding player is the card's owner,
 * whose hand it was in), as well as its zone change, so "whenever a player discards" triggers can see them.
 */
export function discardCards(state: GameState, ids: readonly ObjectId[]): Progress {
  let progress: Progress = { state, events: [] };
  for (const id of ids) {
    const card = progress.state.objects[id];
    if (card?.kind !== "card") throw new Error(`${id} isn't a card`);
    progress = andThen(progress, (s) => {
      const moved = moveCard(s, id, { zone: "graveyard" });
      const discarded = {
        type: "CARD_DISCARDED",
        player: card.owner,
        newId: moved.newId,
        cardId: newCardIdOf(moved),
      } as const;
      return { state: moved.state, events: [...moved.events, discarded] };
    });
  }
  return progress;
}
