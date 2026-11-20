import type { CardDef } from "@mtg/engine";

export const divination: CardDef = {
  name: "Divination",
  oracle: "Draw two cards.",
  spell: {
    targets: [],
    effects: [{ op: "draw", who: "you", amount: 2 }],
  },
};
