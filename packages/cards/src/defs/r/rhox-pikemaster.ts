import type { CardDef } from "@mtg/engine";

export const rhoxPikemaster: CardDef = {
  name: "Rhox Pikemaster",
  oracle:
    "First strike (This creature deals combat damage before creatures without first strike.)\nOther Soldier creatures you control have first strike.",
  keywords: ["first strike"],
  statics: [
    {
      kind: "creaturesGet",
      filter: { types: ["creature"], subtypes: ["Soldier"], controller: "you" },
      others: true,
      power: 0,
      toughness: 0,
      keywords: ["first strike"],
    },
  ],
};
