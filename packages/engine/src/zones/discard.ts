// Discarding a card (CR 701.9a): it moves from its owner's hand to their graveyard.

import type { Progress } from "../game/progress.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import { type Destination, moveCard, newCardIdOf } from "./move-card.ts";

/**
 * Emits `CARD_DISCARDED` (the discarding player is the card's owner, whose hand it was in) as well as its zone change,
 * so "whenever a player discards" triggers can see it. Several cards discarded together are a `simultaneous` event.
 */
export function discardCard(state: GameState, id: ObjectId, to: Destination = { zone: "graveyard" }): Progress {
  const card = state.objects[id];
  if (card?.kind !== "card") throw new Error(`${id} isn't a card`);
  const moved = moveCard(state, id, to);
  // Named where it went only if that's public: a library is hidden from everyone (CR 401.2).
  const hidden = to.zone === "library" || to.zone === "hand";
  const discarded = {
    type: "CARD_DISCARDED",
    player: card.owner,
    newId: hidden ? null : moved.newId,
    cardId: hidden ? null : newCardIdOf(moved),
  } as const;
  return { state: moved.state, events: [...moved.events, discarded] };
}
