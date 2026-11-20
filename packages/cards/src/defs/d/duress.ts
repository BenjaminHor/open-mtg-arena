import type { CardDef } from "@mtg/engine";

export const duress: CardDef = {
  name: "Duress",
  oracle:
    "Target opponent reveals their hand. You choose a noncreature, nonland card from it. That player discards that card.",
  spell: {
    targets: [{ kind: "opponent" }],
    // The reveal is its own effect, so it happens once, before the choice waits (CR 701.20a).
    effects: [
      { op: "revealHand", who: { target: 0 } },
      { op: "discard", who: { target: 0 }, amount: 1, chosenBy: "you", filter: { notTypes: ["creature", "land"] } },
    ],
  },
};
