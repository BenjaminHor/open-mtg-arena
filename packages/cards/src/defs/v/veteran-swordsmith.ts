import type { CardDef } from "@mtg/engine";

export const veteranSwordsmith: CardDef = {
  name: "Veteran Swordsmith",
  oracle: "Other Soldier creatures you control get +1/+0.",
  statics: [
    {
      kind: "creaturesGet",
      filter: { types: ["creature"], subtypes: ["Soldier"], controller: "you" },
      others: true,
      power: 1,
      toughness: 0,
    },
  ],
};
