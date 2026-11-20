import type { CardDef } from "@mtg/engine";

export const brambleCreeper: CardDef = {
  name: "Bramble Creeper",
  oracle: "Whenever this creature attacks, it gets +5/+0 until end of turn.",
  triggers: [
    {
      when: { kind: "selfAttacks" },
      targets: [],
      effects: [{ op: "modifyPT", power: 5, toughness: 0, of: "self", duration: "endOfTurn" }],
    },
  ],
};
