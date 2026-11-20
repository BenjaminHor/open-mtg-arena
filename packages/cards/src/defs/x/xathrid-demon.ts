import type { CardDef } from "@mtg/engine";

export const xathridDemon: CardDef = {
  name: "Xathrid Demon",
  oracle:
    "Flying, trample\nAt the beginning of your upkeep, sacrifice a creature other than this creature, then each opponent loses life equal to the sacrificed creature's power. If you can't sacrifice a creature, tap this creature and you lose 7 life.",
  keywords: ["flying", "trample"],
  triggers: [
    {
      when: { kind: "beginningOfStep", step: "upkeep", whose: "yours" },
      targets: [],
      effects: [
        { op: "sacrifice", who: "you", filter: { types: ["creature"] }, otherThanSelf: true },
        { op: "loseLife", who: "eachOpponent", amount: "sacrificedPower" },
        {
          op: "ifNothingSacrificed",
          effects: [
            { op: "tap", of: "self" },
            { op: "loseLife", who: "you", amount: 7 },
          ],
        },
      ],
    },
  ],
};
