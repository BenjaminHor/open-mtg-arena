import type { CardDef } from "@mtg/engine";

export const earthquake: CardDef = {
  name: "Earthquake",
  oracle: "Earthquake deals X damage to each creature without flying and each player.",
  spell: {
    targets: [],
    // One damage event to every recipient (CR 608.2f); "without flying" is checked as it resolves (its ruling).
    effects: [
      {
        op: "dealDamage",
        amount: "X",
        from: "self",
        to: { each: { types: ["creature"], notKeywords: ["flying"] } },
        and: [{ to: "eachPlayer", amount: "X" }],
      },
    ],
  },
};
