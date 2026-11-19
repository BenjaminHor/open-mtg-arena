import type { CardDef } from "@mtg/engine";

export const lightningBolt: CardDef = {
  name: "Lightning Bolt",
  oracle: "Lightning Bolt deals 3 damage to any target.",
  spell: {
    targets: [{ kind: "anyTarget" }], // CR 115.4
    effects: [{ op: "dealDamage", from: "self", amount: 3, to: { target: 0 } }],
  },
};
