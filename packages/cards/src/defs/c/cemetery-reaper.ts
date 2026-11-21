import type { CardDef } from "@mtg/engine";

export const cemeteryReaper: CardDef = {
  name: "Cemetery Reaper",
  oracle:
    "Other Zombie creatures you control get +1/+1.\n{2}{B}, {T}: Exile target creature card from a graveyard. Create a 2/2 black Zombie creature token.",
  statics: [
    {
      kind: "creaturesGet",
      filter: { types: ["creature"], subtypes: ["Zombie"], controller: "you" },
      others: true,
      power: 1,
      toughness: 1,
    },
  ],
  abilities: [
    {
      kind: "activated",
      cost: [
        {
          kind: "mana",
          cost: [
            { kind: "generic", amount: 2 },
            { kind: "colored", color: "B" },
          ],
        },
        { kind: "tap" },
      ],
      targets: [{ kind: "cardInGraveyard", graveyard: "any", filter: { types: ["creature"] } }],
      // If the card has left the graveyard, the only target is illegal and nothing happens: no token (CR 608.2b).
      effects: [
        { op: "exile", of: { target: 0 } },
        {
          op: "createTokens",
          token: { colors: ["B"], types: ["creature"], subtypes: ["Zombie"], power: 2, toughness: 2 },
          amount: 1,
        },
      ],
    },
  ],
};
