import type { CardDef } from "@mtg/engine";

export const hiveMind: CardDef = {
  name: "Hive Mind",
  oracle:
    "Whenever a player casts an instant or sorcery spell, each other player copies that spell. Each of those players may choose new targets for their copy.",
  triggers: [
    {
      when: { kind: "spellCast", filter: { types: ["instant", "sorcery"] } },
      targets: [],
      // Mandatory (its ruling); a spell countered in response is copied as it last existed (D-125).
      effects: [{ op: "copySpell", of: "triggeringObject", by: "eachOtherPlayer", newTargets: "may" }],
    },
  ],
};
