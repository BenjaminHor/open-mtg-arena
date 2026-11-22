// Who owns an object (CR 108.3): the player who started the game with the card, or a token's creator (CR 111.2).
// A card's owner never changes; "you own" asks this, whoever controls it.

import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";

/** The owner of a card or token (CR 108.3, 111.2); an ability on the stack has none, so asking about one is a bug. */
export function ownerOf(state: GameState, id: ObjectId): PlayerId {
  const obj = state.objects[id];
  if (obj?.kind !== "card") throw new Error(`${id} isn't a card`);
  return obj.owner;
}
