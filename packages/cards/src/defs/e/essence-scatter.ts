import type { CardDef } from "@mtg/engine";

export const essenceScatter: CardDef = {
  name: "Essence Scatter",
  oracle: "Counter target creature spell.",
  spell: {
    targets: [{ kind: "spell", filter: { types: ["creature"] } }],
    effects: [{ op: "counter", of: { target: 0 } }],
  },
};
