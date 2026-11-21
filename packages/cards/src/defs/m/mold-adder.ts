import type { CardDef } from "@mtg/engine";

export const moldAdder: CardDef = {
  name: "Mold Adder",
  oracle: "Whenever an opponent casts a blue or black spell, you may put a +1/+1 counter on this creature.",
  triggers: [
    {
      // A spell both blue and black triggers it once (its ruling): one filter, "any of" the colors.
      when: { kind: "spellCast", filter: { colors: ["U", "B"], controller: "opponent" } },
      optional: true,
      targets: [],
      effects: [{ op: "putCounters", of: "self", counter: "+1/+1", amount: 1 }],
    },
  ],
};
