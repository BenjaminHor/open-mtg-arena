import type { CardDef } from "@mtg/engine";

export const timeWarp: CardDef = {
  name: "Time Warp",
  oracle: "Target player takes an extra turn after this one.",
  spell: {
    targets: [{ kind: "player" }],
    effects: [{ op: "extraTurn", who: { target: 0 } }],
  },
};
