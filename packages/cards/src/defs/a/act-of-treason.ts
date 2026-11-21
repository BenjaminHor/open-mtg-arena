import type { CardDef } from "@mtg/engine";

export const actOfTreason: CardDef = {
  name: "Act of Treason",
  oracle:
    "Gain control of target creature until end of turn. Untap that creature. It gains haste until end of turn. (It can attack and {T} this turn.)",
  spell: {
    // Any creature, even one already untapped or yours (its ruling).
    targets: [{ kind: "permanent", filter: { types: ["creature"] } }],
    effects: [
      { op: "gainControl", of: { target: 0 }, duration: "endOfTurn" },
      { op: "untap", of: { target: 0 } },
      { op: "gainKeywords", keywords: ["haste"], of: { target: 0 }, duration: "endOfTurn" },
    ],
  },
};
