import type { CardDef } from "@mtg/engine";

export const burningInquiry: CardDef = {
  name: "Burning Inquiry",
  oracle: "Each player draws three cards, then discards three cards at random.",
  spell: {
    targets: [],
    effects: [
      { op: "draw", who: "eachPlayer", amount: 3 },
      { op: "discardAtRandom", who: "eachPlayer", amount: 3 },
    ],
  },
};
