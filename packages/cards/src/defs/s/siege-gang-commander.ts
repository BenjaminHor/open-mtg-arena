import type { CardDef } from "@mtg/engine";

export const siegeGangCommander: CardDef = {
  name: "Siege-Gang Commander",
  oracle:
    "When this creature enters, create three 1/1 red Goblin creature tokens.\n{1}{R}, Sacrifice a Goblin: This creature deals 2 damage to any target.",
  triggers: [
    {
      when: { kind: "selfEnters" },
      targets: [],
      effects: [
        {
          op: "createTokens",
          token: { colors: ["R"], types: ["creature"], subtypes: ["Goblin"], power: 1, toughness: 1 },
          amount: 3,
        },
      ],
    },
  ],
  abilities: [
    {
      kind: "activated",
      cost: [
        {
          kind: "mana",
          cost: [
            { kind: "generic", amount: 1 },
            { kind: "colored", color: "R" },
          ],
        },
        // Any Goblin its controller controls: a token, or itself (CR 701.21a); sacrificed, it still deals the damage, as
        // it last existed (CR 113.7a, 608.2h).
        { kind: "sacrifice", filter: { subtypes: ["Goblin"] } },
      ],
      targets: [{ kind: "anyTarget" }],
      effects: [{ op: "dealDamage", amount: 2, from: "self", to: { target: 0 } }],
    },
  ],
};
