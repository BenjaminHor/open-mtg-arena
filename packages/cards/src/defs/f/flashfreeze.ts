import type { CardDef } from "@mtg/engine";

export const flashfreeze: CardDef = {
  name: "Flashfreeze",
  oracle: "Counter target red or green spell.",
  spell: {
    targets: [{ kind: "spell", filter: { colors: ["R", "G"] } }],
    effects: [{ op: "counter", of: { target: 0 } }],
  },
};
