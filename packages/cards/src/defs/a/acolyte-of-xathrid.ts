import type { CardDef } from "@mtg/engine";

export const acolyteOfXathrid: CardDef = {
  name: "Acolyte of Xathrid",
  oracle: "{1}{B}, {T}: Target player loses 1 life.",
  abilities: [
    {
      kind: "activated",
      cost: [
        {
          kind: "mana",
          cost: [
            { kind: "generic", amount: 1 },
            { kind: "colored", color: "B" },
          ],
        },
        { kind: "tap" },
      ],
      targets: [{ kind: "player" }],
      effects: [{ op: "loseLife", who: { target: 0 }, amount: 1 }],
    },
  ],
};
