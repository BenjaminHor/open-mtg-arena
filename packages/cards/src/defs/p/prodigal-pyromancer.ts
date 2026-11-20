import type { CardDef } from "@mtg/engine";

export const prodigalPyromancer: CardDef = {
  name: "Prodigal Pyromancer",
  oracle: "{T}: This creature deals 1 damage to any target.",
  abilities: [
    {
      kind: "activated",
      cost: [{ kind: "tap" }],
      targets: [{ kind: "anyTarget" }],
      effects: [{ op: "dealDamage", amount: 1, from: "self", to: { target: 0 } }],
    },
  ],
};
