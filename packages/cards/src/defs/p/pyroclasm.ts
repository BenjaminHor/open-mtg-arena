import type { CardDef } from "@mtg/engine";

export const pyroclasm: CardDef = {
  name: "Pyroclasm",
  oracle: "Pyroclasm deals 2 damage to each creature.",
  spell: {
    targets: [],
    effects: [{ op: "dealDamage", amount: 2, from: "self", to: { each: { types: ["creature"] } } }],
  },
};
