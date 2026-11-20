import type { CardDef } from "@mtg/engine";

export const honorOfThePure: CardDef = {
  name: "Honor of the Pure",
  oracle: "White creatures you control get +1/+1.",
  statics: [
    { kind: "creaturesGet", filter: { types: ["creature"], colors: ["W"], controller: "you" }, power: 1, toughness: 1 },
  ],
};
