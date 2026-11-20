import type { CardDef } from "@mtg/engine";

export const windstorm: CardDef = {
  name: "Windstorm",
  oracle: "Windstorm deals X damage to each creature with flying.",
  spell: {
    targets: [],
    effects: [
      { op: "dealDamage", amount: "X", from: "self", to: { each: { types: ["creature"], keywords: ["flying"] } } },
    ],
  },
};
