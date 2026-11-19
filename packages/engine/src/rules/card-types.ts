// An object's card types (CR 205.2), for code that asks "is this a creature?", "is this an instant?".

import type { CardDatabase, CardType } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";

/**
 * The card types an object has now. Until `characteristics()` and the layer system arrive (M1-11), that's the printed
 * types; type-changing effects (layer 4) will change the answer here, in one place.
 */
export function cardTypesOf(state: GameState, id: ObjectId, cards: CardDatabase): CardType[] {
  const obj = state.objects[id];
  if (obj?.kind !== "card") return [];
  const data = cards[obj.oracleId];
  if (data === undefined) throw new Error(`No card data for ${obj.oracleId}`);
  return data.printed.types;
}
