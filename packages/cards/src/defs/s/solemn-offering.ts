import type { CardDef } from "@mtg/engine";

export const solemnOffering: CardDef = {
  name: "Solemn Offering",
  oracle: "Destroy target artifact or enchantment. You gain 4 life.",
  spell: {
    targets: [{ kind: "permanent", filter: { types: ["artifact", "enchantment"] } }],
    effects: [
      { op: "destroy", of: { target: 0 } },
      { op: "gainLife", who: "you", amount: 4 },
    ],
  },
};
