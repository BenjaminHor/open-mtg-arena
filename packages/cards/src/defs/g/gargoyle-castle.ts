import type { CardDef } from "@mtg/engine";

export const gargoyleCastle: CardDef = {
  name: "Gargoyle Castle",
  oracle:
    "{T}: Add {C}.\n{5}, {T}, Sacrifice this land: Create a 3/4 colorless Gargoyle artifact creature token with flying.",
  abilities: [
    {
      // A mana ability (CR 605.1a).
      kind: "activated",
      cost: [{ kind: "tap" }],
      targets: [],
      effects: [{ op: "addMana", mana: "C", amount: 1 }],
    },
    {
      kind: "activated",
      cost: [{ kind: "mana", cost: [{ kind: "generic", amount: 5 }] }, { kind: "tap" }, { kind: "sacrificeSelf" }],
      targets: [],
      effects: [
        {
          op: "createTokens",
          // Colorless: no colors (CR 105.2c).
          token: {
            colors: [],
            types: ["artifact", "creature"],
            subtypes: ["Gargoyle"],
            power: 3,
            toughness: 4,
            keywords: ["flying"],
          },
          amount: 1,
        },
      ],
    },
  ],
};
