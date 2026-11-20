import type { CardDef } from "@mtg/engine";

export const goblinChieftain: CardDef = {
  name: "Goblin Chieftain",
  oracle:
    "Haste (This creature can attack and {T} as soon as it comes under your control.)\nOther Goblin creatures you control get +1/+1 and have haste.",
  keywords: ["haste"],
  statics: [
    {
      kind: "creaturesGet",
      filter: { types: ["creature"], subtypes: ["Goblin"], controller: "you" },
      others: true,
      power: 1,
      toughness: 1,
      keywords: ["haste"],
    },
  ],
};
