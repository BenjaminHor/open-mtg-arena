import type { CardDef } from "@mtg/engine";

export const holyStrength: CardDef = {
  name: "Holy Strength",
  oracle: "Enchant creature\nEnchanted creature gets +1/+2.",
  enchant: { types: ["creature"] },
  statics: [{ kind: "attachedGets", power: 1, toughness: 2 }],
};
