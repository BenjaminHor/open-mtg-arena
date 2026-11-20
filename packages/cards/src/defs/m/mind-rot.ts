import type { CardDef } from "@mtg/engine";

export const mindRot: CardDef = {
  name: "Mind Rot",
  oracle: "Target player discards two cards.",
  spell: {
    targets: [{ kind: "player" }],
    // The target player chooses which (CR 701.9b).
    effects: [{ op: "discard", who: { target: 0 }, amount: 2 }],
  },
};
