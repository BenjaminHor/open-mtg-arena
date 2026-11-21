import type { CardDef } from "@mtg/engine";

const yourCreatures = { each: { types: ["creature" as const], controller: "you" as const } };

export const ajaniGoldmane: CardDef = {
  name: "Ajani Goldmane",
  oracle:
    '+1: You gain 2 life.\n−1: Put a +1/+1 counter on each creature you control. Those creatures gain vigilance until end of turn.\n−6: Create a white Avatar creature token. It has "This token\'s power and toughness are each equal to your life total."',
  abilities: [
    {
      kind: "activated",
      cost: [{ kind: "loyalty", amount: 1 }],
      targets: [],
      effects: [{ op: "gainLife", who: "you", amount: 2 }],
    },
    {
      kind: "activated",
      cost: [{ kind: "loyalty", amount: -1 }],
      targets: [],
      // "Those creatures": the same set, as nothing happens between the two effects (CR 608.2c). The vigilance stays
      // even if the counter is removed (its ruling).
      effects: [
        { op: "putCounters", of: yourCreatures, counter: "+1/+1", amount: 1 },
        { op: "gainKeywords", keywords: ["vigilance"], of: yourCreatures, duration: "endOfTurn" },
      ],
    },
    {
      kind: "activated",
      cost: [{ kind: "loyalty", amount: -6 }],
      targets: [],
      effects: [
        {
          op: "createTokens",
          token: {
            colors: ["W"],
            types: ["creature"],
            subtypes: ["Avatar"],
            power: "*",
            toughness: "*",
            // A characteristic-defining ability (CR 604.3): it changes as the life total changes (its ruling).
            statics: [{ kind: "powerToughnessEachEqual", to: "yourLifeTotal" }],
          },
          amount: 1,
        },
      ],
    },
  ],
};
