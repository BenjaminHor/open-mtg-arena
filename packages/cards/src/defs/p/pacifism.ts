import type { CardDef } from "@mtg/engine";

export const pacifism: CardDef = {
  name: "Pacifism",
  oracle: "Enchant creature\nEnchanted creature can't attack or block.",
  enchant: { types: ["creature"] },
  statics: [{ kind: "attachedCantAttackOrBlock" }],
};
