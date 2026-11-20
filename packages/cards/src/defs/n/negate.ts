import type { CardDef } from "@mtg/engine";

export const negate: CardDef = {
  name: "Negate",
  oracle: "Counter target noncreature spell.",
  spell: {
    targets: [{ kind: "spell", filter: { notTypes: ["creature"] } }],
    effects: [{ op: "counter", of: { target: 0 } }],
  },
};
