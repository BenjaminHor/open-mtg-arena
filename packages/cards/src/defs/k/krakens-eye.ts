import type { CardDef } from "@mtg/engine";

export const krakensEye: CardDef = {
  name: "Kraken's Eye",
  oracle: "Whenever a player casts a blue spell, you may gain 1 life.",
  triggers: [
    {
      when: { kind: "spellCast", filter: { colors: ["U"] } },
      optional: true,
      targets: [],
      effects: [{ op: "gainLife", who: "you", amount: 1 }],
    },
  ],
};
