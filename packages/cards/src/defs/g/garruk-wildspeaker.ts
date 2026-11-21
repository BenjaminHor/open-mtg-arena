import type { CardDef } from "@mtg/engine";

const yourCreatures = { each: { types: ["creature" as const], controller: "you" as const } };

export const garrukWildspeaker: CardDef = {
  name: "Garruk Wildspeaker",
  oracle:
    "+1: Untap two target lands.\n−1: Create a 3/3 green Beast creature token.\n−4: Creatures you control get +3/+3 and gain trample until end of turn.",
  abilities: [
    {
      kind: "activated",
      cost: [{ kind: "loyalty", amount: 1 }],
      // Any two lands, tapped or not (its ruling).
      targets: [{ kind: "permanent", filter: { types: ["land"] }, count: { min: 2, max: 2 } }],
      effects: [{ op: "untap", of: { target: 0 } }],
    },
    {
      kind: "activated",
      cost: [{ kind: "loyalty", amount: -1 }],
      targets: [],
      effects: [
        {
          op: "createTokens",
          token: { colors: ["G"], types: ["creature"], subtypes: ["Beast"], power: 3, toughness: 3 },
          amount: 1,
        },
      ],
    },
    {
      kind: "activated",
      cost: [{ kind: "loyalty", amount: -4 }],
      targets: [],
      // Only the creatures you control as it resolves (its ruling, CR 611.2c).
      effects: [
        { op: "modifyPT", power: 3, toughness: 3, of: yourCreatures, duration: "endOfTurn" },
        { op: "gainKeywords", keywords: ["trample"], of: yourCreatures, duration: "endOfTurn" },
      ],
    },
  ],
};
