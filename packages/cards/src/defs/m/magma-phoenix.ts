import type { CardDef } from "@mtg/engine";

export const magmaPhoenix: CardDef = {
  name: "Magma Phoenix",
  oracle:
    "Flying\nWhen this creature dies, it deals 3 damage to each creature and each player.\n{3}{R}{R}: Return this card from your graveyard to your hand.",
  keywords: ["flying"],
  triggers: [
    {
      when: { kind: "selfDies" },
      targets: [],
      effects: [
        {
          op: "dealDamage",
          amount: 3,
          from: "self",
          to: { each: { types: ["creature"] } },
          and: [{ to: "eachPlayer", amount: 3 }],
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
            { kind: "generic", amount: 3 },
            { kind: "colored", color: "R" },
            { kind: "colored", color: "R" },
          ],
        },
      ],
      targets: [],
      effects: [{ op: "returnToHand", of: "self" }],
      zone: "graveyard",
    },
  ],
};
