import type { CardDef } from "@mtg/engine";

export const dragonWhelp: CardDef = {
  name: "Dragon Whelp",
  oracle:
    "Flying\n{R}: This creature gets +1/+0 until end of turn. If this ability has been activated four or more times this turn, sacrifice this creature at the beginning of the next end step.",
  keywords: ["flying"],
  abilities: [
    {
      kind: "activated",
      cost: [{ kind: "mana", cost: [{ kind: "colored", color: "R" }] }],
      targets: [],
      effects: [
        { op: "modifyPT", power: 1, toughness: 0, of: "self", duration: "endOfTurn" },
        // Counted as each activation is made, checked as each resolves (D-078): four stacked make four delayed triggers.
        {
          op: "ifActivatedThisTurn",
          atLeast: 4,
          effects: [
            {
              op: "createDelayedTrigger",
              ability: {
                when: { kind: "beginningOfStep", step: "end", whose: "each" },
                targets: [],
                effects: [{ op: "sacrificeSource" }],
              },
            },
          ],
        },
      ],
    },
  ],
};
