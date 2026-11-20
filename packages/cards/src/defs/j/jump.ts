import type { CardDef } from "@mtg/engine";

export const jump: CardDef = {
  name: "Jump",
  oracle: "Target creature gains flying until end of turn.",
  spell: {
    targets: [{ kind: "permanent", filter: { types: ["creature"] } }],
    effects: [{ op: "gainKeywords", keywords: ["flying"], of: { target: 0 }, duration: "endOfTurn" }],
  },
};
