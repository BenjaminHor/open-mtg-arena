import type { CardDef } from "@mtg/engine";

export const veteranArmorsmith: CardDef = {
  name: "Veteran Armorsmith",
  oracle: "Other Soldier creatures you control get +0/+1.",
  statics: [
    {
      kind: "creaturesGet",
      filter: { types: ["creature"], subtypes: ["Soldier"], controller: "you" },
      others: true,
      power: 0,
      toughness: 1,
    },
  ],
};
