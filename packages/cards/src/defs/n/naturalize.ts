import type { CardDef } from "@mtg/engine";

export const naturalize: CardDef = {
  name: "Naturalize",
  oracle: "Destroy target artifact or enchantment.",
  spell: {
    targets: [{ kind: "permanent", filter: { types: ["artifact", "enchantment"] } }],
    effects: [{ op: "destroy", of: { target: 0 } }],
  },
};
