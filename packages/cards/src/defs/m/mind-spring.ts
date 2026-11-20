import type { CardDef } from "@mtg/engine";

export const mindSpring: CardDef = {
  name: "Mind Spring",
  oracle: "Draw X cards.",
  spell: {
    targets: [],
    effects: [{ op: "draw", who: "you", amount: "X" }],
  },
};
