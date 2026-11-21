// A token's "printed" characteristics, from the effect that creates it (CR 111.3), in the shape a card's take, so the
// layer system reads both the same way.

import type { CardData, TokenDef } from "./types.ts";

/**
 * The card data a token starts from. Its oracle id (`token:Insect Token`) names no card in the database: it only labels the
 * token in state dumps, and two different tokens may share one, as the data is kept on each token (`cardDataOf`).
 */
export function tokenData(token: TokenDef): CardData {
  // "Its name is the same as its subtype(s) plus the word Token" unless the text names it (CR 111.4).
  const name = token.name ?? [...token.subtypes, "Token"].join(" ");
  return {
    oracleId: `token:${name}`,
    printed: {
      name,
      manaCost: null,
      colors: [...token.colors],
      colorIndicator: [],
      supertypes: [],
      types: [...token.types],
      subtypes: [...token.subtypes],
      power: token.power,
      toughness: token.toughness,
    },
    def: { name, oracle: "", ...(token.keywords === undefined ? {} : { keywords: [...token.keywords] }) },
  };
}
