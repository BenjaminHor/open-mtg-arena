import type { CardDef } from "@mtg/engine";

export const signInBlood: CardDef = {
  name: "Sign in Blood",
  oracle: "Target player draws two cards and loses 2 life.",
  spell: {
    targets: [{ kind: "player" }],
    effects: [
      { op: "draw", who: { target: 0 }, amount: 2 },
      { op: "loseLife", who: { target: 0 }, amount: 2 },
    ],
  },
};
