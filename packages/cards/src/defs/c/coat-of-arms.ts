import type { CardDef } from "@mtg/engine";

export const coatOfArms: CardDef = {
  name: "Coat of Arms",
  oracle:
    "Each creature gets +1/+1 for each other creature on the battlefield that shares at least one creature type with it. (For example, if two Goblin Warriors and a Goblin Shaman are on the battlefield, each gets +2/+2.)",
  statics: [{ kind: "plusPerSharedCreatureType" }],
};
