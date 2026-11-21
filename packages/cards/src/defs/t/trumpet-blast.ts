import type { CardDef } from "@mtg/engine";

export const trumpetBlast: CardDef = {
  name: "Trumpet Blast",
  oracle: "Attacking creatures get +2/+0 until end of turn.",
  spell: {
    targets: [],
    // Every player's attacking creatures, fixed as it resolves (CR 611.2c, its ruling).
    effects: [
      {
        op: "modifyPT",
        power: 2,
        toughness: 0,
        of: { each: { types: ["creature"], combat: "attacking" } },
        duration: "endOfTurn",
      },
    ],
  },
};
