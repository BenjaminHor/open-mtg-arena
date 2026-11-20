import type { CardDef } from "@mtg/engine";

export const deathmark: CardDef = {
  name: "Deathmark",
  oracle: "Destroy target green or white creature.",
  spell: {
    targets: [{ kind: "permanent", filter: { types: ["creature"], colors: ["G", "W"] } }],
    effects: [{ op: "destroy", of: { target: 0 } }],
  },
};
