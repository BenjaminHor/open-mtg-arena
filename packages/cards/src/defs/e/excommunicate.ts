import type { CardDef } from "@mtg/engine";

export const excommunicate: CardDef = {
  name: "Excommunicate",
  oracle: "Put target creature on top of its owner's library.",
  spell: {
    targets: [{ kind: "permanent", filter: { types: ["creature"] } }],
    effects: [{ op: "putOnTopOfLibrary", of: { target: 0 } }],
  },
};
