import type { CardDef } from "@mtg/engine";

export const manabarbs: CardDef = {
  name: "Manabarbs",
  oracle: "Whenever a player taps a land for mana, this enchantment deals 1 damage to that player.",
  triggers: [
    {
      when: { kind: "landTappedForMana" },
      targets: [],
      effects: [{ op: "dealDamage", amount: 1, from: "self", to: "triggeringPlayer" }],
    },
  ],
};
