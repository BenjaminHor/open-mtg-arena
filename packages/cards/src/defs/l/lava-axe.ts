import type { CardDef } from "@mtg/engine";

export const lavaAxe: CardDef = {
  name: "Lava Axe",
  oracle: "Lava Axe deals 5 damage to target player or planeswalker.",
  spell: {
    targets: [{ kind: "playerOrPlaneswalker" }],
    effects: [{ op: "dealDamage", amount: 5, from: "self", to: { target: 0 } }],
  },
};
