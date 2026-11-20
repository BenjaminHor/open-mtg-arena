import type { CardDef } from "@mtg/engine";

export const hypnoticSpecter: CardDef = {
  name: "Hypnotic Specter",
  oracle: "Flying\nWhenever this creature deals damage to an opponent, that player discards a card at random.",
  keywords: ["flying"],
  triggers: [
    {
      when: { kind: "selfDealsDamageToPlayer", player: "opponent", combatOnly: false },
      targets: [],
      effects: [{ op: "discardAtRandom", who: "triggeringPlayer", amount: 1 }],
    },
  ],
};
