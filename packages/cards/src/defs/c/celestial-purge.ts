import type { CardDef } from "@mtg/engine";

export const celestialPurge: CardDef = {
  name: "Celestial Purge",
  oracle: "Exile target black or red permanent.",
  spell: {
    targets: [{ kind: "permanent", filter: { colors: ["B", "R"] } }],
    effects: [{ op: "exile", of: { target: 0 } }],
  },
};
