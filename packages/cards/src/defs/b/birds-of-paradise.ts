import type { CardDef } from "@mtg/engine";

export const birdsOfParadise: CardDef = {
  name: "Birds of Paradise",
  oracle: "Flying\n{T}: Add one mana of any color.",
  keywords: ["flying"],
  abilities: [
    {
      // A mana ability (CR 605.1a): the color is chosen as it resolves, right after activation (CR 605.3b, D-068).
      kind: "activated",
      cost: [{ kind: "tap" }],
      targets: [],
      effects: [{ op: "addMana", mana: "anyColor", amount: 1 }],
    },
  ],
};
