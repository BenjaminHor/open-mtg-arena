import type { CardDef } from "@mtg/engine";

export const overrun: CardDef = {
  name: "Overrun",
  oracle:
    "Creatures you control get +3/+3 and gain trample until end of turn. (Each of those creatures can deal excess combat damage to the player or planeswalker it's attacking.)",
  spell: {
    targets: [],
    effects: [
      {
        op: "modifyPT",
        power: 3,
        toughness: 3,
        of: { each: { types: ["creature"], controller: "you" } },
        duration: "endOfTurn",
      },
      {
        op: "gainKeywords",
        keywords: ["trample"],
        of: { each: { types: ["creature"], controller: "you" } },
        duration: "endOfTurn",
      },
    ],
  },
};
