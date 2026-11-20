import type { CardDef } from "@mtg/engine";

export const mightOfOaks: CardDef = {
  name: "Might of Oaks",
  oracle: "Target creature gets +7/+7 until end of turn.",
  spell: {
    targets: [{ kind: "permanent", filter: { types: ["creature"] } }],
    effects: [{ op: "modifyPT", power: 7, toughness: 7, of: { target: 0 }, duration: "endOfTurn" }],
  },
};
