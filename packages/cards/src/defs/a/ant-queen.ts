import type { CardDef } from "@mtg/engine";

export const antQueen: CardDef = {
  name: "Ant Queen",
  oracle: "{1}{G}: Create a 1/1 green Insect creature token.",
  abilities: [
    {
      kind: "activated",
      cost: [
        {
          kind: "mana",
          cost: [
            { kind: "generic", amount: 1 },
            { kind: "colored", color: "G" },
          ],
        },
      ],
      targets: [],
      effects: [
        {
          op: "createTokens",
          token: { colors: ["G"], types: ["creature"], subtypes: ["Insect"], power: 1, toughness: 1 },
          amount: 1,
        },
      ],
    },
  ],
};
