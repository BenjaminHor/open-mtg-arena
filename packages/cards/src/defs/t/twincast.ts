import type { CardDef } from "@mtg/engine";

export const twincast: CardDef = {
  name: "Twincast",
  oracle: "Copy target instant or sorcery spell. You may choose new targets for the copy.",
  spell: {
    targets: [{ kind: "spell", filter: { types: ["instant", "sorcery"] } }],
    effects: [{ op: "copySpell", of: { target: 0 }, newTargets: "may" }],
  },
};
