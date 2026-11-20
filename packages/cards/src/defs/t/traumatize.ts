import type { CardDef } from "@mtg/engine";

export const traumatize: CardDef = {
  name: "Traumatize",
  oracle: "Target player mills half their library, rounded down.",
  spell: {
    targets: [{ kind: "player" }],
    effects: [{ op: "mill", who: { target: 0 }, amount: "halfTheirLibrary" }],
  },
};
