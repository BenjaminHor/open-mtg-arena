import type { CardDef } from "@mtg/engine";

export const openTheVaults: CardDef = {
  name: "Open the Vaults",
  oracle:
    "Return all artifact and enchantment cards from all graveyards to the battlefield under their owners' control. (Auras with nothing to enchant remain in graveyards.)",
  spell: {
    targets: [],
    effects: [
      {
        op: "returnAllToBattlefield",
        from: "allGraveyards",
        filter: { types: ["artifact", "enchantment"] },
        under: "owners",
      },
    ],
  },
};
