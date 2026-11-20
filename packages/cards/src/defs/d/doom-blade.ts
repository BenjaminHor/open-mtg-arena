import type { CardDef } from "@mtg/engine";

export const doomBlade: CardDef = {
  name: "Doom Blade",
  oracle: "Destroy target nonblack creature.",
  spell: {
    targets: [{ kind: "permanent", filter: { types: ["creature"], notColors: ["B"] } }],
    effects: [{ op: "destroy", of: { target: 0 } }],
  },
};
