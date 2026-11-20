import type { CardDef } from "@mtg/engine";

export const wurmsTooth: CardDef = {
  name: "Wurm's Tooth",
  oracle: "Whenever a player casts a green spell, you may gain 1 life.",
  triggers: [
    {
      when: { kind: "spellCast", filter: { colors: ["G"] } },
      optional: true,
      targets: [],
      effects: [{ op: "gainLife", who: "you", amount: 1 }],
    },
  ],
};
