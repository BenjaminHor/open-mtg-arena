import type { CardDef } from "@mtg/engine";

export const mindShatter: CardDef = {
  name: "Mind Shatter",
  oracle: "Target player discards X cards at random.",
  spell: {
    targets: [{ kind: "player" }],
    effects: [{ op: "discardAtRandom", who: { target: 0 }, amount: "X" }],
  },
};
