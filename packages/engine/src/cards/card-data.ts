// Where an object's printed characteristics come from: a card's from the `CardDatabase` (D-022), a token's from the
// effect that created it, kept on the object (CR 111.3). Every lookup goes through here (card-data-lookups.test.ts
// checks it), so nothing reads a token as a card the database doesn't have.

import type { CardObject } from "../state/objects.ts";
import type { CardData, CardDatabase } from "./types.ts";

/** The card data a card or token starts from; undefined for a card the database doesn't have. */
export function cardDataOf(obj: CardObject, cards: CardDatabase): CardData | undefined {
  return obj.token ?? cards[obj.oracleId];
}

/**
 * The card data an oracle id names: the card an ability on the stack came from, a revealed card. A token's oracle id
 * names none, so this is undefined for it: a token's own abilities would need its data kept on the ability object, and
 * no token in the pool has an activated or triggered ability yet (later).
 */
export function cardDataByOracleId(oracleId: string, cards: CardDatabase): CardData | undefined {
  return cards[oracleId];
}
