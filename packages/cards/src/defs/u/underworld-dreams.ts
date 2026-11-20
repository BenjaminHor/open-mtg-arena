import type { CardDef } from "@mtg/engine";

export const underworldDreams: CardDef = {
  name: "Underworld Dreams",
  oracle: "Whenever an opponent draws a card, this enchantment deals 1 damage to that player.",
  triggers: [
    {
      when: { kind: "playerDraws", player: "opponent" },
      targets: [],
      effects: [{ op: "dealDamage", amount: 1, from: "self", to: "triggeringPlayer" }],
    },
  ],
};
