// The card database the engine is given: each pool card's printed characteristics plus its definition.

import type { CardData, CardDatabase, CardDef } from "@mtg/engine";
import poolJson from "../data/pool.json" with { type: "json" };
import { CARD_DEFS } from "./defs/index.ts";
import type { PoolFile } from "./pool-data.ts";
import { printedCard } from "./printed.ts";

export const POOL: PoolFile = poolJson;

/** Builds the database from the committed pool data and definitions. Throws if a card is missing either. */
export function cardDatabase(defs: readonly CardDef[] = CARD_DEFS, pool: PoolFile = POOL): CardDatabase {
  const byName = new Map(defs.map((d) => [d.name, d]));
  const db: CardDatabase = {};
  for (const card of pool.cards) {
    const def = byName.get(card.name);
    if (def === undefined) throw new Error(`${card.name} is in the pool but has no definition`);
    const data: CardData = { oracleId: card.oracleId, printed: printedCard(card), def };
    db[card.oracleId] = data;
  }
  return db;
}
