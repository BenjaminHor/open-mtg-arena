import type { CardDef } from "@mtg/engine";

export const armoredAscension: CardDef = {
  name: "Armored Ascension",
  oracle: "Enchant creature\nEnchanted creature gets +1/+1 for each Plains you control and has flying.",
  enchant: { types: ["creature"] },
  // "You" is the Aura's controller (CR 109.5), whoever controls the creature; Plains by subtype, basic or not.
  statics: [
    {
      kind: "attachedGets",
      power: 1,
      toughness: 1,
      perCount: { subtypes: ["Plains"], controller: "you" },
      keywords: ["flying"],
    },
  ],
};
