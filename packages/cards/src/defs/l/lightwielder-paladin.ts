import type { CardDef } from "@mtg/engine";

export const lightwielderPaladin: CardDef = {
  name: "Lightwielder Paladin",
  oracle:
    "First strike (This creature deals combat damage before creatures without first strike.)\nWhenever this creature deals combat damage to a player, you may exile target black or red permanent that player controls.",
  keywords: ["first strike"],
  triggers: [
    {
      when: { kind: "selfDealsDamageToPlayer", player: "anyPlayer", combatOnly: true },
      optional: true,
      targets: [{ kind: "permanent", filter: { colors: ["B", "R"], controller: "triggeringPlayer" } }],
      effects: [{ op: "exile", of: { target: 0 } }],
    },
  ],
};
