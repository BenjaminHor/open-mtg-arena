import type { CardDef } from "@mtg/engine";

export const megrim: CardDef = {
  name: "Megrim",
  oracle: "Whenever an opponent discards a card, this enchantment deals 2 damage to that player.",
  triggers: [
    {
      when: { kind: "playerDiscards", player: "opponent" },
      targets: [],
      effects: [{ op: "dealDamage", amount: 2, from: "self", to: "triggeringPlayer" }],
    },
  ],
};
