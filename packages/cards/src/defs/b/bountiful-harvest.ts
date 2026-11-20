import type { CardDef } from "@mtg/engine";

export const bountifulHarvest: CardDef = {
  name: "Bountiful Harvest",
  oracle: "You gain 1 life for each land you control.",
  spell: {
    targets: [],
    effects: [{ op: "gainLife", who: "you", amount: { count: { types: ["land"], controller: "you" } } }],
  },
};
