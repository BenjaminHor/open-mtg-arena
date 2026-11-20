import type { CardDef } from "@mtg/engine";

export const regenerate: CardDef = {
  name: "Regenerate",
  oracle:
    "Regenerate target creature. (The next time that creature would be destroyed this turn, instead tap it, remove it from combat, and heal all damage on it.)",
  spell: {
    targets: [{ kind: "permanent", filter: { types: ["creature"] } }],
    effects: [{ op: "regenerate", of: { target: 0 } }],
  },
};
