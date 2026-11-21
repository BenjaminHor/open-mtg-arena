import type { CardDef } from "@mtg/engine";

export const iceCage: CardDef = {
  name: "Ice Cage",
  oracle:
    "Enchant creature\nEnchanted creature can't attack or block, and its activated abilities can't be activated.\nWhen enchanted creature becomes the target of a spell or ability, destroy this Aura.",
  enchant: { types: ["creature"] },
  statics: [{ kind: "attachedCantAttackOrBlock" }, { kind: "attachedCantActivate" }],
  triggers: [
    {
      when: { kind: "attachedBecomesTarget" },
      targets: [],
      effects: [{ op: "destroy", of: "self" }],
    },
  ],
};
