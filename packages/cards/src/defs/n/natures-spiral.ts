import type { CardDef } from "@mtg/engine";

export const naturesSpiral: CardDef = {
  name: "Nature's Spiral",
  oracle: "Return target permanent card from your graveyard to your hand.",
  spell: {
    targets: [
      {
        kind: "cardInGraveyard",
        graveyard: "yours",
        // A permanent card: one with a permanent type (CR 110.4a).
        filter: { types: ["artifact", "battle", "creature", "enchantment", "land", "planeswalker"] },
      },
    ],
    effects: [{ op: "returnToHand", of: { target: 0 } }],
  },
};
