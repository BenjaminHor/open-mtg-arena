import type { CardDef } from "@mtg/engine";

export const demonsHorn: CardDef = {
  name: "Demon's Horn",
  oracle: "Whenever a player casts a black spell, you may gain 1 life.",
  triggers: [
    {
      when: { kind: "spellCast", filter: { colors: ["B"] } },
      optional: true,
      targets: [],
      effects: [{ op: "gainLife", who: "you", amount: 1 }],
    },
  ],
};
