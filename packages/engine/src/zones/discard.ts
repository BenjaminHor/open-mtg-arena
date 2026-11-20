// Discarding cards (CR 701.9a): they move from their owner's hand to their graveyard.

import { andThen, type Progress } from "../game/progress.ts";
import { zoneChangeOf } from "../pipeline/moved.ts";
import type { CarryOut } from "../pipeline/proposed.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";

/**
 * Discards these cards as one action. Emits `CARD_DISCARDED` for each (the discarding player is the card's owner,
 * whose hand it was in), as well as its zone change, so "whenever a player discards" triggers can see them. Each zone
 * change is its own event, proposed through `next`.
 */
export function discardCards(state: GameState, ids: readonly ObjectId[], next: CarryOut): Progress {
  let progress: Progress = { state, events: [] };
  for (const id of ids) {
    const card = progress.state.objects[id];
    if (card?.kind !== "card") throw new Error(`${id} isn't a card`);
    progress = andThen(progress, (s) => {
      const moved = next(s, { kind: "moveCard", object: id, to: { zone: "graveyard" } });
      const change = zoneChangeOf(moved.events, id);
      if (change === null) throw new Error(`${id} wasn't discarded`);
      const discarded = {
        type: "CARD_DISCARDED",
        player: card.owner,
        newId: change.newId,
        cardId: change.newCardId,
      } as const;
      return { state: moved.state, events: [...moved.events, discarded] };
    });
  }
  return progress;
}
