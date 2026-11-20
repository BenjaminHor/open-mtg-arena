import type { CardDef } from "@mtg/engine";

export const consumeSpirit: CardDef = {
  name: "Consume Spirit",
  oracle: "Spend only black mana on X.\nConsume Spirit deals X damage to any target and you gain X life.",
  spell: {
    targets: [{ kind: "anyTarget" }],
    // X life, the number chosen, even if some damage is prevented (its ruling).
    xPaidWith: "B",
    effects: [
      { op: "dealDamage", amount: "X", from: "self", to: { target: 0 } },
      { op: "gainLife", who: "you", amount: "X" },
    ],
  },
};
