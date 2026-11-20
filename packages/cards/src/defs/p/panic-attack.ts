import type { CardDef } from "@mtg/engine";

export const panicAttack: CardDef = {
  name: "Panic Attack",
  oracle: "Up to three target creatures can't block this turn.",
  spell: {
    targets: [{ kind: "permanent", filter: { types: ["creature"] }, count: { min: 0, max: 3 } }],
    effects: [{ op: "cantBlock", of: { target: 0 }, duration: "endOfTurn" }],
  },
};
