import type { CardDef } from "@mtg/engine";

export const tomeScour: CardDef = {
  name: "Tome Scour",
  oracle: "Target player mills five cards.",
  spell: {
    targets: [{ kind: "player" }],
    effects: [{ op: "mill", who: { target: 0 }, amount: 5 }],
  },
};
