import type { CardDef } from "@mtg/engine";

export const angelsFeather: CardDef = {
  name: "Angel's Feather",
  oracle: "Whenever a player casts a white spell, you may gain 1 life.",
  triggers: [
    {
      when: { kind: "spellCast", filter: { colors: ["W"] } },
      optional: true,
      targets: [],
      effects: [{ op: "gainLife", who: "you", amount: 1 }],
    },
  ],
};
