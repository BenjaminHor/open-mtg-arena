import type { CardDef } from "@mtg/engine";

export const shock: CardDef = {
  name: "Shock",
  oracle: "Shock deals 2 damage to any target.",
  spell: {
    targets: [{ kind: "anyTarget" }], // CR 115.4
    effects: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
  },
};
