import type { CardDef } from "@mtg/engine";

export const capriciousEfreet: CardDef = {
  name: "Capricious Efreet",
  oracle:
    "At the beginning of your upkeep, choose target nonland permanent you control and up to two target nonland permanents you don't control. Destroy one of them at random.",
  triggers: [
    {
      when: { kind: "beginningOfStep", step: "upkeep", whose: "yours" },
      targets: [
        { kind: "permanent", filter: { notTypes: ["land"], controller: "you" } },
        { kind: "permanent", filter: { notTypes: ["land"], controller: "notYou" }, count: { min: 0, max: 2 } },
      ],
      effects: [{ op: "destroyOneAtRandom", among: [{ target: 0 }, { target: 1 }] }],
    },
  ],
};
