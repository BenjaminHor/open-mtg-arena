import type { CardDef } from "@mtg/engine";

export const harmsWay: CardDef = {
  name: "Harm's Way",
  oracle:
    "The next 2 damage that a source of your choice would deal to you and/or permanents you control this turn is dealt to any target instead.",
  spell: {
    targets: [{ kind: "anyTarget" }], // CR 115.4
    effects: [{ op: "redirectNextDamage", amount: 2, to: { target: 0 } }],
  },
};
