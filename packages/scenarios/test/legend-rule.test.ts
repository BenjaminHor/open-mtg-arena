// The legend rule's decision (CR 704.5j) in scenarios: `choose: <name>#n` keeps the nth of the same-named legends, and
// the exporter writes it back that way. No legendary card is in the pool yet, so a legendary Grizzly Bears stands in.

import { cardDatabase } from "@mtg/cards";
import { type CardDatabase, createGame, legalActions } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { scenarioFromGame } from "../src/export.ts";
import { runScenario } from "../src/index.ts";
import { buildSetup } from "../src/setup.ts";

const pool = cardDatabase();
const bears = Object.values(pool).find((c) => c.printed.name === "Grizzly Bears");
if (bears === undefined) throw new Error("no Grizzly Bears in the pool");
const cards: CardDatabase = {
  ...pool,
  "test-legend": {
    ...bears,
    oracleId: "test-legend",
    printed: { ...bears.printed, name: "Test Legend", supertypes: ["legendary"] },
    def: { ...bears.def, name: "Test Legend" },
  },
};

const scenario = (choice: string) => `name: legend rule
rules: [CR 704.5j]
setup:
  turn: { active: p1, step: main1 }
  p1:
    battlefield: [Test Legend, { card: Test Legend, damage: 1 }]
steps:
  - expect:
      pending: { player: p1, kind: keepLegend }
  - p1 choose: ${choice}
  - expect:
      p1.graveyard: [Test Legend]
      p1:Test Legend.damage: 1
`;

describe("the legend rule in scenarios (CR 704.5j)", () => {
  it("keeps the nth of the same-named legends with `#n`", () => {
    expect(runScenario(scenario("Test Legend#2"), cards).problems).toStrictEqual([]);
    expect(runScenario(scenario("Test Legend"), cards).problems).not.toStrictEqual([]);
    expect(runScenario(scenario("Test Legend#3"), cards).problems.join()).toMatch(/no Test Legend#3 to keep/);
  });

  it("is exported as that same step", () => {
    const setup = buildSetup(
      {
        turn: { active: "p1", step: "main1" },
        p1: { battlefield: ["Test Legend", { card: "Test Legend", damage: 1 }] },
      },
      cards,
    );
    const created = createGame(setup, cards);
    if (!created.ok) throw new Error(created.error.message);
    const keepSecond = legalActions(created.state, "p1", cards)[1];
    if (keepSecond === undefined) throw new Error("no second option");
    const yaml = scenarioFromGame("legend rule", ["CR 704.5j"], setup, [keepSecond], cards);
    expect(yaml).toMatch(/p1 choose: Test Legend#2/);
    expect(runScenario(yaml, cards).problems).toStrictEqual([]);
  });
});
