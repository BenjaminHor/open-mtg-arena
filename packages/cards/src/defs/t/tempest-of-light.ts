import type { CardDef } from "@mtg/engine";

export const tempestOfLight: CardDef = {
  name: "Tempest of Light",
  oracle: "Destroy all enchantments.",
  spell: {
    targets: [],
    effects: [{ op: "destroyAll", filter: { types: ["enchantment"] } }],
  },
};
