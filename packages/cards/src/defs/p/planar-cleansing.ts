import type { CardDef } from "@mtg/engine";

export const planarCleansing: CardDef = {
  name: "Planar Cleansing",
  oracle: "Destroy all nonland permanents.",
  spell: {
    targets: [],
    effects: [{ op: "destroy", of: { each: { notTypes: ["land"] } } }],
  },
};
