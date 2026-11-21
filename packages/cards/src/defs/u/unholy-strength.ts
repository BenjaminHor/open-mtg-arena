import type { CardDef } from "@mtg/engine";

export const unholyStrength: CardDef = {
  name: "Unholy Strength",
  oracle: "Enchant creature\nEnchanted creature gets +2/+1.",
  enchant: { types: ["creature"] },
  statics: [{ kind: "attachedGets", power: 2, toughness: 1 }],
};
