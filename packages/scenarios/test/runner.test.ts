// The runner itself: a scenario that should fail must fail, with a readable reason. Otherwise a broken runner would
// make every scenario pass.

import { readFileSync } from "node:fs";
import { cardDatabase } from "@mtg/cards";
import { createGame } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { COMING_EXPECTATIONS, COMING_STEP_WORDS, invariantProblems, runScenario, STEP_NAMES } from "../src/index.ts";

const cards = cardDatabase();
const problems = (yaml: string) => runScenario(yaml, cards).problems;
const header = "name: test\nrules: [CR 117.3d]\nsetup:\n  turn: { active: p1, step: main1 }\n";

describe("the scenario runner", () => {
  it("passes a correct scenario", () => {
    expect(
      problems(`${header}steps:\n  - p1 pass: once\n  - expect: { pending: { player: p2, kind: priority } }\n`),
    ).toStrictEqual([]);
  });

  it("fails a wrong expectation, saying what it got", () => {
    expect(problems(`${header}steps:\n  - expect: { step: main2 }\n`)).toStrictEqual([
      'step 1: step: expected "main2", got "main1"',
    ]);
  });

  it("fails a step that isn't a legal action", () => {
    expect(problems(`${header}steps:\n  - p2 pass: once\n`)[0]).toMatch(/p2 can't pass: it isn't a legal action/);
  });

  it("fails a step whose action isn't among the player's legal actions, even when they have others", () => {
    const discard =
      "name: t\nrules: [CR 514.1]\nsetup:\n  turn: { active: p1, step: end }\n  p1: { hand: [Forest, Forest, Forest, Forest, Forest, Forest, Forest, Forest] }\n";
    expect(problems(`${discard}steps:\n  - all pass: once\n  - p1 pass: once\n`)[0]).toMatch(
      /p1 can't pass: it isn't a legal action/,
    );
  });

  it("fails an 'expect error' when the action is accepted, or rejected with another code", () => {
    expect(problems(`${header}steps:\n  - p1 pass: once\n  - expect error: notYourPriority\n`)[0]).toMatch(
      /expected error notYourPriority, but the action was accepted/,
    );
    expect(problems(`${header}steps:\n  - p2 pass: once\n  - expect error: staleDecision\n`)[0]).toMatch(
      /expected error staleDecision, got notYourPriority/,
    );
  });

  it("fails on unknown keys, steps and expectations instead of ignoring them", () => {
    expect(() => problems(`${header}stepz: []\n`)).toThrow(/Unknown top-level key "stepz"/);
    expect(() => problems(`${header}steps:\n  - p1 dance: once\n`)).toThrow(/unknown step word "dance"/);
    expect(problems(`${header}steps:\n  - expect: { p1.lifee: 20 }\n`)[0]).toMatch(/unknown expectation/);
    expect(
      problems(`name: t\nrules: [CR 1]\nsetup:\n  turn: { active: p1, step: main1 }\n  p1: { hnad: [Forest] }\n`)[0],
    ).toMatch(/Unknown key "hnad"/);
  });

  it("says when a step or expectation arrives in a later task", () => {
    expect(problems(`${header}steps:\n  - p1 cast: Shock\n`)).toStrictEqual(['step 1: "cast" steps arrive in M1-09']);
    expect(problems(`${header}steps:\n  - expect: { winner: p1 }\n`)).toStrictEqual([
      "step 1: winner: arrives in M1-15",
    ]);
  });

  it("fails 'all pass: until' a step that never begins with priority, instead of hanging", () => {
    // Empty libraries, so no one draws and no cleanup discard interrupts the passing.
    const empty =
      "name: t\nrules: [CR 502.4]\nsetup:\n  turn: { active: p1, step: main1 }\n  p1: { library: [] }\n  p2: { library: [] }\n";
    expect(problems(`${empty}steps:\n  - all pass: until untap\n`)[0]).toMatch(
      /didn't reach that step with priority in 500 passes/,
    );
  });

  it("checks a rejected setup's reason", () => {
    const rejected = "name: t\nrules: [CR 103.5]\nsetup:\n  opening: standard\n  p2: { library: [Mountain] }\n";
    expect(problems(`${rejected}expect setup error: at least 7 cards\n`)).toStrictEqual([]);
    expect(problems(`${rejected}expect setup error: something else\n`)[0]).toMatch(/expected "something else"/);
  });
});

describe("invariantProblems", () => {
  it("reports an object that's in no zone, and a zone entry that isn't an object", () => {
    const created = createGame(
      {
        seed: 1,
        players: [
          {
            id: "p1",
            life: 20,
            library: [],
            hand: [],
            battlefield: [],
            graveyard: [],
            exile: [],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
          },
          {
            id: "p2",
            life: 20,
            library: [],
            hand: [],
            battlefield: [],
            graveyard: [],
            exile: [],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
          },
        ],
        opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
        ruleModifiers: [],
      },
      cards,
    );
    if (!created.ok) throw new Error(created.error.message);
    expect(invariantProblems(created.state, cards)).toStrictEqual([]);
    const broken = { ...created.state, zones: { ...created.state.zones, exile: ["o999" as const] } };
    expect(invariantProblems(broken, cards)).toContain("zone entry o999 isn't an object");
  });
});

describe("docs/testing.md", () => {
  // The format documented must match the runner exactly (M1-16's acceptance): every word the runner knows is documented.
  const doc = readFileSync(new URL("../../../docs/testing.md", import.meta.url), "utf8");
  it("documents every step name, coming step word and coming expectation", () => {
    const words = [...Object.keys(STEP_NAMES), ...Object.keys(COMING_STEP_WORDS), ...Object.keys(COMING_EXPECTATIONS)];
    for (const word of words)
      expect(new RegExp(`[\`\\s.]${word.replace(".", "\\.")}[\`:\\s]`).test(doc), word).toBe(true);
  });
});
