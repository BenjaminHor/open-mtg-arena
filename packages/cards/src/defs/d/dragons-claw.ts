import type { CardDef } from "@mtg/engine";

export const dragonsClaw: CardDef = {
  name: "Dragon's Claw",
  oracle: "Whenever a player casts a red spell, you may gain 1 life.",
  triggers: [
    {
      when: { kind: "spellCast", filter: { colors: ["R"] } },
      optional: true,
      targets: [],
      effects: [{ op: "gainLife", who: "you", amount: 1 }],
    },
  ],
};
