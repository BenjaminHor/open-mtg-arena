// The card database the engine is given: each pool card's printed characteristics plus its definition.

import type { CardData, CardDatabase } from "@mtg/engine";
import { CARD_DEFS } from "./defs/index.ts";
import { POOL } from "./pool.ts";
import { printedCard } from "./printed.ts";

export { POOL };

/** Builds the database from the committed pool data and definitions. Throws if a card is missing either. */
export function cardDatabase(): CardDatabase {
  const byName = new Map(CARD_DEFS.map((d) => [d.name, d]));
  const db: CardDatabase = {};
  for (const card of POOL.cards) {
    const def = byName.get(card.name);
    if (def === undefined) throw new Error(`${card.name} is in the pool but has no definition`);
    const data: CardData = { oracleId: card.oracleId, printed: printedCard(card), def };
    db[card.oracleId] = data;
  }
  return db;
}
