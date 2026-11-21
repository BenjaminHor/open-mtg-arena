import type { CardDef } from "@mtg/engine";

export const captainOfTheWatch: CardDef = {
  name: "Captain of the Watch",
  oracle:
    "Vigilance (Attacking doesn't cause this creature to tap.)\nOther Soldier creatures you control get +1/+1 and have vigilance.\nWhen this creature enters, create three 1/1 white Soldier creature tokens.",
  keywords: ["vigilance"],
  statics: [
    {
      kind: "creaturesGet",
      filter: { types: ["creature"], subtypes: ["Soldier"], controller: "you" },
      others: true,
      power: 1,
      toughness: 1,
      keywords: ["vigilance"],
    },
  ],
  triggers: [
    {
      when: { kind: "selfEnters" },
      targets: [],
      effects: [
        {
          op: "createTokens",
          token: { colors: ["W"], types: ["creature"], subtypes: ["Soldier"], power: 1, toughness: 1 },
          amount: 3,
        },
      ],
    },
  ],
};
