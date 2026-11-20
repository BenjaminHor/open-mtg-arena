import type { CardDef } from "@mtg/engine";

export const rodOfRuin: CardDef = {
  name: "Rod of Ruin",
  oracle: "{3}, {T}: This artifact deals 1 damage to any target.",
  abilities: [
    {
      kind: "activated",
      cost: [{ kind: "mana", cost: [{ kind: "generic", amount: 3 }] }, { kind: "tap" }],
      targets: [{ kind: "anyTarget" }],
      effects: [{ op: "dealDamage", amount: 1, from: "self", to: { target: 0 } }],
    },
  ],
};
