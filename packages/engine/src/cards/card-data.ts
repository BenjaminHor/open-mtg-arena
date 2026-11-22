// Where an object's printed characteristics come from: a card's from the `CardDatabase` (D-022), a token's from the
// effect that created it, kept on the object (CR 111.3). Every lookup goes through here (card-data-lookups.test.ts
// checks it), so nothing reads a token as a card the database doesn't have.

import type { OracleId } from "../state/ids.ts";
import type { CardObject, Copiable } from "../state/objects.ts";
import type { CardData, CardDatabase } from "./types.ts";

/**
 * The card data a card or token starts from: its copiable values (CR 707.2), a copy effect's if it entered as a copy
 * (layer 1, CR 613.2a), else its own. Undefined for a card the database doesn't have.
 */
export function cardDataOf(obj: CardObject, cards: CardDatabase): CardData | undefined {
  return copiableData(obj.copied ?? obj, cards);
}

/** The card data copiable values name: a token's own, or the card's in the database. */
export function copiableData(values: Copiable, cards: CardDatabase): CardData | undefined {
  return values.token ?? cards[values.oracleId];
}

/** What a copy of this object copies (CR 707.2, 707.3): the values it copies itself, else its own. */
export function copiableValues(obj: CardObject): Copiable {
  return (
    obj.copied ?? (obj.token === undefined ? { oracleId: obj.oracleId } : { oracleId: obj.oracleId, token: obj.token })
  );
}

/**
 * The oracle id of the text the object has: the copied card's for a copy. An ability names it as the card it came from
 * (`sourceOracleId`), so it resolves from the text it was activated or triggered from.
 */
export function textOracleId(obj: CardObject): OracleId {
  return obj.copied?.oracleId ?? obj.oracleId;
}

/** Whether an object is a token, which isn't a card (CR 111.6): "creature card" filters leave it out. */
export function isToken(obj: CardObject): boolean {
  return obj.token !== undefined;
}

/**
 * The card data an oracle id names: the card an ability on the stack came from, a revealed card. A token's oracle id
 * names none, so this is undefined for it: a token's own abilities would need its data kept on the ability object, and
 * no token in the pool has an activated or triggered ability yet (later).
 */
export function cardDataByOracleId(oracleId: string, cards: CardDatabase): CardData | undefined {
  return cards[oracleId];
}

/**
 * Every card name a player may name (CR 201.4: the name of a card, not of a token unless a card has it), sorted. The
 * game knows its own card database only, so that's the list (D-114).
 */
export function cardNames(cards: CardDatabase): string[] {
  // Kept in a plain record to drop repeats in one pass: the full database (M4) has tens of thousands of names.
  const seen: Record<string, true> = {};
  for (const card of Object.values(cards)) seen[card.printed.name] = true;
  return Object.keys(seen).sort();
}

/** Whether a card in the database has this name (CR 201.4), without listing them all. */
export function isCardName(name: string, cards: CardDatabase): boolean {
  return Object.values(cards).some((c) => c.printed.name === name);
}
