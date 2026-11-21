import type { CardDef } from "@mtg/engine";

export const sphinxAmbassador: CardDef = {
  name: "Sphinx Ambassador",
  oracle:
    "Flying\nWhenever this creature deals combat damage to a player, search that player's library for a card, then that player chooses a card name. If you searched for a creature card that doesn't have that name, you may put it onto the battlefield under your control. Then that player shuffles.",
  keywords: ["flying"],
  triggers: [
    {
      when: { kind: "selfDealsDamageToPlayer", player: "anyPlayer", combatOnly: true },
      targets: [],
      effects: [
        // Any card, seen only by the searcher (its ruling): the player naming doesn't see it.
        { op: "search", library: "triggeringPlayer", count: "one" },
        { op: "nameCard", who: "triggeringPlayer" },
        {
          op: "put",
          of: "found",
          into: "battlefield",
          onlyIf: { types: ["creature"], notNamedThisWay: true },
          optional: true,
        },
        { op: "shuffle", who: "triggeringPlayer" },
      ],
    },
  ],
};
