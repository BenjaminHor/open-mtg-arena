import type { CardDef } from "@mtg/engine";

export const divineVerdict: CardDef = {
  name: "Divine Verdict",
  oracle: "Destroy target attacking or blocking creature.",
  spell: {
    targets: [{ kind: "permanent", filter: { types: ["creature"], combat: "attackingOrBlocking" } }],
    effects: [{ op: "destroy", of: { target: 0 } }],
  },
};
