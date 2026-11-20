import type { CardDef } from "@mtg/engine";

export const giantGrowth: CardDef = {
  name: "Giant Growth",
  oracle: "Target creature gets +3/+3 until end of turn.",
  spell: {
    targets: [{ kind: "permanent", filter: { types: ["creature"] } }],
    effects: [{ op: "modifyPT", power: 3, toughness: 3, of: { target: 0 }, duration: "endOfTurn" }],
  },
};
