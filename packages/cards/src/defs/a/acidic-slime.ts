import type { CardDef } from "@mtg/engine";

export const acidicSlime: CardDef = {
  name: "Acidic Slime",
  oracle:
    "Deathtouch (Any amount of damage this deals to a creature is enough to destroy it.)\nWhen this creature enters, destroy target artifact, enchantment, or land.",
  keywords: ["deathtouch"],
  triggers: [
    {
      when: { kind: "selfEnters" },
      targets: [{ kind: "permanent", filter: { types: ["artifact", "enchantment", "land"] } }],
      effects: [{ op: "destroy", of: { target: 0 } }],
    },
  ],
};
