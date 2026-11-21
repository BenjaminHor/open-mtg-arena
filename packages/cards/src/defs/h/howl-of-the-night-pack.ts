import type { CardDef } from "@mtg/engine";

export const howlOfTheNightPack: CardDef = {
  name: "Howl of the Night Pack",
  oracle: "Create a 2/2 green Wolf creature token for each Forest you control.",
  spell: {
    targets: [],
    effects: [
      {
        op: "createTokens",
        token: { colors: ["G"], types: ["creature"], subtypes: ["Wolf"], power: 2, toughness: 2 },
        // Counted as it resolves (CR 608.2h): Forests by subtype, basic or not.
        amount: { count: { subtypes: ["Forest"], controller: "you" } },
      },
    ],
  },
};
