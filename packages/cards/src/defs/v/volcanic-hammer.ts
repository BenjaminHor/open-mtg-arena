import type { CardDef } from "@mtg/engine";

export const volcanicHammer: CardDef = {
  name: "Volcanic Hammer",
  oracle: "Volcanic Hammer deals 3 damage to any target.",
  spell: {
    targets: [{ kind: "anyTarget" }], // CR 115.4
    effects: [{ op: "dealDamage", amount: 3, to: { target: 0 } }],
  },
};
