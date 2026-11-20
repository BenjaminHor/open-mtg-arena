import type { CardDef } from "@mtg/engine";

export const unsummon: CardDef = {
  name: "Unsummon",
  oracle: "Return target creature to its owner's hand.",
  spell: {
    targets: [{ kind: "permanent", filter: { types: ["creature"] } }],
    effects: [{ op: "returnToHand", of: { target: 0 } }],
  },
};
