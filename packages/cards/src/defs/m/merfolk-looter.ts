import type { CardDef } from "@mtg/engine";

export const merfolkLooter: CardDef = {
  name: "Merfolk Looter",
  oracle: "{T}: Draw a card, then discard a card.",
  abilities: [
    {
      kind: "activated",
      cost: [{ kind: "tap" }],
      targets: [],
      // Nothing can happen between the draw and the discard: they're one resolution (CR 608.2g; its ruling).
      effects: [
        { op: "draw", who: "you", amount: 1 },
        { op: "discard", who: "you", amount: 1 },
      ],
    },
  ],
};
