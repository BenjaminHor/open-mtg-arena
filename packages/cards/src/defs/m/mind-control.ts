import type { CardDef } from "@mtg/engine";

export const mindControl: CardDef = {
  name: "Mind Control",
  oracle: "Enchant creature\nYou control enchanted creature.",
  enchant: { types: ["creature"] },
  statics: [{ kind: "attachedControl" }],
};
