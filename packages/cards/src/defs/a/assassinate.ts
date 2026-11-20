import type { CardDef } from "@mtg/engine";

export const assassinate: CardDef = {
  name: "Assassinate",
  oracle: "Destroy target tapped creature.",
  spell: {
    targets: [{ kind: "permanent", filter: { types: ["creature"], tapped: true } }],
    effects: [{ op: "destroy", of: { target: 0 } }],
  },
};
