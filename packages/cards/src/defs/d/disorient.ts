import type { CardDef } from "@mtg/engine";

export const disorient: CardDef = {
  name: "Disorient",
  oracle: "Target creature gets -7/-0 until end of turn.",
  spell: {
    targets: [{ kind: "permanent", filter: { types: ["creature"] } }],
    effects: [{ op: "modifyPT", power: -7, toughness: 0, of: { target: 0 }, duration: "endOfTurn" }],
  },
};
