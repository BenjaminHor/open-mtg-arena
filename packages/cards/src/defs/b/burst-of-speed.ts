import type { CardDef } from "@mtg/engine";

export const burstOfSpeed: CardDef = {
  name: "Burst of Speed",
  oracle:
    "Creatures you control gain haste until end of turn. (They can attack and {T} even if they just came under your control.)",
  spell: {
    targets: [],
    effects: [
      {
        op: "gainKeywords",
        keywords: ["haste"],
        of: { each: { types: ["creature"], controller: "you" } },
        duration: "endOfTurn",
      },
    ],
  },
};
