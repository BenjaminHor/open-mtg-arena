import type { CardDef } from "@mtg/engine";

export const ponder: CardDef = {
  name: "Ponder",
  oracle:
    "Look at the top three cards of your library, then put them back in any order. You may shuffle.\nDraw a card.",
  spell: {
    targets: [],
    effects: [
      { op: "lookAtTop", count: 3 },
      { op: "shuffle", who: "you", optional: true },
      { op: "draw", who: "you", amount: 1 },
    ],
  },
};
