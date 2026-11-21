import type { CardDef } from "@mtg/engine";

export const proteanHydra: CardDef = {
  name: "Protean Hydra",
  oracle:
    "This creature enters with X +1/+1 counters on it.\nIf damage would be dealt to this creature, prevent that damage and remove that many +1/+1 counters from it.\nWhenever a +1/+1 counter is removed from this creature, put two +1/+1 counters on it at the beginning of the next end step.",
  replacements: [
    { kind: "entersWithCounters", counter: "+1/+1", amount: "X" },
    { kind: "preventDamageToSelfRemovingCounters", counter: "+1/+1" },
  ],
  triggers: [
    {
      // For any reason, once per counter (its rulings).
      when: { kind: "selfCountersRemoved", counter: "+1/+1" },
      targets: [],
      effects: [
        {
          op: "createDelayedTrigger",
          about: "self",
          ability: {
            when: { kind: "beginningOfStep", step: "end", whose: "each" },
            targets: [],
            effects: [{ op: "putCounters", of: "remembered", counter: "+1/+1", amount: 2 }],
          },
        },
      ],
    },
  ],
};
