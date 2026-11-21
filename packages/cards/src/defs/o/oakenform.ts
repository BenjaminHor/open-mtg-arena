import type { CardDef } from "@mtg/engine";

export const oakenform: CardDef = {
  name: "Oakenform",
  oracle: "Enchant creature\nEnchanted creature gets +3/+3.",
  enchant: { types: ["creature"] },
  statics: [{ kind: "attachedGets", power: 3, toughness: 3 }],
};
