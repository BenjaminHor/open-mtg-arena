import type { CardDef } from "@mtg/engine";

export const cancel: CardDef = {
  name: "Cancel",
  oracle: "Counter target spell.",
  spell: {
    targets: [{ kind: "spell", filter: {} }],
    effects: [{ op: "counter", of: { target: 0 } }],
  },
};
