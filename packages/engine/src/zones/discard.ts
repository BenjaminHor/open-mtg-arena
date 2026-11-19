// Discarding a card (CR 701.9a): it moves from its owner's hand to their graveyard.

import type { Progress } from "../game/progress.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { moveCard } from "./move-card.ts";

/** Emits `CARD_DISCARDED` as well as the zone change, so "whenever a player discards" triggers can see it. */
export function discardCard(state: GameState, player: PlayerId, id: ObjectId): Progress {
  const card = state.objects[id];
  if (card?.kind !== "card") throw new Error(`${id} isn't a card`);
  const moved = moveCard(state, id, { zone: "graveyard" });
  const discarded = { type: "CARD_DISCARDED", player, newId: moved.newId, cardId: card.cardId } as const;
  return { state: moved.state, events: [...moved.events, discarded] };
}
