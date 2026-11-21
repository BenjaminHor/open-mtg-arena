import type { CardDef } from "@mtg/engine";

export const jaceBeleren: CardDef = {
  name: "Jace Beleren",
  oracle: "+2: Each player draws a card.\n−1: Target player draws a card.\n−10: Target player mills twenty cards.",
  abilities: [
    {
      kind: "activated",
      cost: [{ kind: "loyalty", amount: 2 }],
      targets: [],
      effects: [{ op: "draw", who: "eachPlayer", amount: 1 }],
    },
    {
      kind: "activated",
      cost: [{ kind: "loyalty", amount: -1 }],
      targets: [{ kind: "player" }],
      effects: [{ op: "draw", who: { target: 0 }, amount: 1 }],
    },
    {
      kind: "activated",
      cost: [{ kind: "loyalty", amount: -10 }],
      targets: [{ kind: "player" }],
      // Fewer than twenty: all of them (its ruling).
      effects: [{ op: "mill", who: { target: 0 }, amount: 20 }],
    },
  ],
};
