import type { CardDef } from "@mtg/engine";

export const gloriousCharge: CardDef = {
  name: "Glorious Charge",
  oracle: "Creatures you control get +1/+1 until end of turn.",
  spell: {
    targets: [],
    effects: [
      {
        op: "modifyPT",
        power: 1,
        toughness: 1,
        of: { each: { types: ["creature"], controller: "you" } },
        duration: "endOfTurn",
      },
    ],
  },
};
