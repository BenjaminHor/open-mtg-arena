import type { CardDef } from "@mtg/engine";

export const chandraNalaar: CardDef = {
  name: "Chandra Nalaar",
  oracle:
    "+1: Chandra Nalaar deals 1 damage to target player or planeswalker.\n−X: Chandra Nalaar deals X damage to target creature.\n−8: Chandra Nalaar deals 10 damage to target player or planeswalker and each creature that player or that planeswalker's controller controls.",
  abilities: [
    {
      kind: "activated",
      cost: [{ kind: "loyalty", amount: 1 }],
      targets: [{ kind: "playerOrPlaneswalker" }],
      effects: [{ op: "dealDamage", amount: 1, from: "self", to: { target: 0 } }],
    },
    {
      kind: "activated",
      // X from 0 up to her loyalty (its ruling, CR 606.6).
      cost: [{ kind: "loyalty", amount: "minusX" }],
      targets: [{ kind: "permanent", filter: { types: ["creature"] } }],
      effects: [{ op: "dealDamage", amount: "X", from: "self", to: { target: 0 } }],
    },
    {
      kind: "activated",
      cost: [{ kind: "loyalty", amount: -8 }],
      targets: [{ kind: "playerOrPlaneswalker" }],
      // One damage event to all of them (CR 608.2f, 120.4).
      effects: [
        {
          op: "dealDamage",
          amount: 10,
          from: "self",
          to: { target: 0 },
          and: [{ to: { eachControlledBy: { target: 0 }, filter: { types: ["creature"] } }, amount: 10 }],
        },
      ],
    },
  ],
};
