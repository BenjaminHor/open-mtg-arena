import type { CardDef } from "@mtg/engine";

export const kindledFury: CardDef = {
  name: "Kindled Fury",
  oracle:
    "Target creature gets +1/+0 and gains first strike until end of turn. (It deals combat damage before creatures without first strike.)",
  spell: {
    targets: [{ kind: "permanent", filter: { types: ["creature"] } }],
    effects: [
      { op: "modifyPT", power: 1, toughness: 0, of: { target: 0 }, duration: "endOfTurn" },
      { op: "gainKeywords", keywords: ["first strike"], of: { target: 0 }, duration: "endOfTurn" },
    ],
  },
};
