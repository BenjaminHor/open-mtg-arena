import type { CardDef } from "@mtg/engine";

export const mesaEnchantress: CardDef = {
  name: "Mesa Enchantress",
  oracle: "Whenever you cast an enchantment spell, you may draw a card.",
  triggers: [
    {
      when: { kind: "spellCast", filter: { types: ["enchantment"], controller: "you" } },
      optional: true,
      targets: [],
      effects: [{ op: "draw", who: "you", amount: 1 }],
    },
  ],
};
