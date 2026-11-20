import type { CardDef } from "@mtg/engine";

export const shatter: CardDef = {
  name: "Shatter",
  oracle: "Destroy target artifact.",
  spell: {
    targets: [{ kind: "permanent", filter: { types: ["artifact"] } }],
    effects: [{ op: "destroy", of: { target: 0 } }],
  },
};
