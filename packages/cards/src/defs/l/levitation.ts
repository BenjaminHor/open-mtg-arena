import type { CardDef } from "@mtg/engine";

export const levitation: CardDef = {
  name: "Levitation",
  oracle: "Creatures you control have flying.",
  statics: [
    {
      kind: "creaturesGet",
      filter: { types: ["creature"], controller: "you" },
      power: 0,
      toughness: 0,
      keywords: ["flying"],
    },
  ],
};
