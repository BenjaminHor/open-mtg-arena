// The runner itself: a scenario that should fail must fail, with a readable reason. Otherwise a broken runner would
// make every scenario pass.

import { readFileSync } from "node:fs";
import { cardDatabase } from "@mtg/cards";
import { createGame } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { allPass } from "../src/all-pass.ts";
import { EXPECTATIONS } from "../src/expect.ts";
import { STEP_OPTIONS, TOP_KEYS } from "../src/format.ts";
import { COMING_EXPECTATIONS, COMING_STEP_WORDS, invariantProblems, runScenario, STEP_NAMES } from "../src/index.ts";
import { buildSetup, PERMANENT_KEYS, PLAYER_KEYS, SETUP_KEYS, TURN_KEYS } from "../src/setup.ts";

const cards = cardDatabase();
const problems = (yaml: string) => runScenario(yaml, cards).problems;
const first = (yaml: string) => problems(yaml)[0] ?? "";
const at = (step: string, extra = "") =>
  `name: test\nrules: [CR 117.3d]\nsetup:\n  turn: { active: p1, step: ${step} }\n${extra}steps:\n`;
const main1 = at("main1");

describe("the scenario runner passes a correct scenario", () => {
  it("passes", () => {
    expect(
      problems(`${main1}  - p1 pass: once\n  - expect: { pending: { player: p2, kind: priority } }\n`),
    ).toStrictEqual([]);
  });
});

describe("the scenario runner fails a scenario that's wrong", () => {
  it("fails a wrong expectation, saying what it got", () => {
    expect(problems(`${main1}  - expect: { step: main2 }\n`)).toStrictEqual([
      'step 1: step: expected "main2", got "main1"',
    ]);
  });

  it("fails a step whose action isn't legal, even when the player has other legal actions", () => {
    expect(first(`${main1}  - p2 pass: once\n`)).toMatch(/p2 can't pass: it isn't a legal action/);
    const discard = at("end", "  p1: { hand: [Forest, Forest, Forest, Forest, Forest, Forest, Forest, Forest] }\n");
    expect(first(`${discard}  - all pass: once\n  - p1 pass: once\n`)).toMatch(
      /p1 can't pass: it isn't a legal action/,
    );
  });

  it("fails an 'expect error' when the action is accepted, or rejected with another code", () => {
    expect(first(`${main1}  - p1 pass: once\n  - expect error: notYourPriority\n`)).toMatch(
      /but the action was accepted/,
    );
    expect(first(`${main1}  - p2 pass: once\n  - expect error: staleDecision\n`)).toMatch(/got notYourPriority/);
  });

  it("treats a whole cast as one step under 'expect error': a fully legal cast is reported as accepted", () => {
    const bolt = at("main1", "  p1: { hand: [Lightning Bolt], battlefield: [Mountain, Mountain] }\n");
    expect(
      first(`${bolt}  - p1 cast: Lightning Bolt\n    targets: [p2]\n    pay: auto\n  - expect error: illegalAction\n`),
    ).toMatch(/but the action was accepted/);
  });

  it("matches every key of pending, not just one", () => {
    expect(first(`${main1}  - expect: { pending: { player: p2, kind: priority } }\n`)).toMatch(
      /^step 1: pending: expected/,
    );
  });

  it("matches nested maps in 'events contains' on their keys given, and fails a wrong nested value", () => {
    const bolt = at("main1", "  p1: { hand: [Lightning Bolt], battlefield: [Mountain] }\n");
    const cast = `${bolt}  - p1 cast: Lightning Bolt\n    targets: [p2]\n    pay: auto\n  - all pass: once\n`;
    const dealtTo = (player: string) =>
      `${cast}  - expect: { events contains: [{ type: DAMAGE_DEALT, to: { player: ${player} } }] }\n`;
    expect(problems(dealtTo("p2"))).toStrictEqual([]);
    expect(first(dealtTo("p1"))).toMatch(/events contains: expected/);
  });

  it("compares zone lists in order, and checks 'contains' and 'count'", () => {
    const yard = at("main1", "  p1: { graveyard: [Shock, Forest] }\n");
    expect(problems(`${yard}  - expect: { p1.graveyard: [Shock, Forest] }\n`)).toStrictEqual([]);
    expect(first(`${yard}  - expect: { p1.graveyard: [Forest, Shock] }\n`)).toMatch(/expected \["Forest","Shock"\]/);
    expect(problems(`${yard}  - expect: { p1.graveyard contains: [Forest], p1.graveyard count: 2 }\n`)).toStrictEqual(
      [],
    );
    expect(first(`${yard}  - expect: { p1.graveyard contains: [Grizzly Bears] }\n`)).toMatch(/contains: expected/);
    expect(first(`${yard}  - expect: { p1.graveyard contains: [Shock, Shock] }\n`)).toMatch(/contains: expected/);
  });

  it("matches events on every key given, only among the last step's events, each event once", () => {
    const passes = `${main1}  - p1 pass: once\n  - p2 pass: once\n`;
    expect(
      problems(`${passes}  - expect: { events contains: [{ type: PRIORITY_PASSED, player: p2 }] }\n`),
    ).toStrictEqual([]);
    expect(first(`${passes}  - expect: { events contains: [{ type: PRIORITY_PASSED, player: p1 }] }\n`)).toMatch(
      /events contains/,
    );
    expect(
      first(`${passes}  - expect: { events contains: [{ type: PRIORITY_PASSED }, { type: PRIORITY_PASSED }] }\n`),
    ).toMatch(/events contains/);
  });

  it("compares maps whatever their key order", () => {
    const pools = at("main1", "  p1: { manaPool: { R: 2, G: 1 } }\n");
    expect(problems(`${pools}  - expect: { p1.manaPool: { G: 1, R: 2 } }\n`)).toStrictEqual([]);
  });

  it("checks every state against the invariants, including the first", () => {
    const failing = runScenario(`${main1}  - expect: { step: main1 }\n`, cards, () => ["planted problem"]);
    expect(failing.problems[0]).toMatch(/invariant broken: planted problem/);
    let checked = 0;
    runScenario(`${main1}  - p1 pass: once\n  - p2 pass: once\n`, cards, () => {
      checked++;
      return [];
    });
    expect(checked).toBe(3); // the starting state and the state after each pass
  });

  it("fails 'all pass: until' a step no one gets priority in, instead of hanging", () => {
    // Untap gives no one priority. With nothing played, hands grow until the cleanup discard (CR 514.1) stops it.
    expect(first(`${main1}  - all pass: until untap\n`)).toMatch(/expected someone to have priority/);
    // The pass limit itself, with a small limit (500 passes would take a game far past its libraries).
    const created = createGame(buildSetup({ turn: { active: "p1", step: "main1" } }, cards), cards);
    if (!created.ok) throw new Error(created.error.message);
    const game = { state: created.state, events: [] };
    expect(() => allPass(game, "untap", cards, () => {}, 3)).toThrow(
      /didn't reach that step with priority in 3 passes/,
    );
  });

  it("fails 'all pass: until' a step the game ends before, and passing once the game is over", () => {
    const dying = at("main1", "  p2: { library: [] }\n");
    expect(first(`${dying}  - all pass: until main1\n`)).toMatch(/the game ended before that step began/);
    // Untap begins on p2's turn, but the game ends in p2's draw step: that isn't reaching untap.
    expect(first(`${dying}  - all pass: until untap\n`)).toMatch(/the game ended before that step began/);
    expect(problems(`${dying}  - all pass: until draw\n  - expect: { winner: p1 }\n`)).toStrictEqual([]);
    expect(first(`${dying}  - all pass: until draw\n  - expect: { winner: p2 }\n`)).toMatch(/winner: expected "p2"/);
    const over = at("main1", "  p2: { life: 0 }\n");
    expect(first(`${over}  - all pass: once\n`)).toMatch(/the game is over/);
  });
});

describe("the scenario runner refuses what it can't read, instead of ignoring it", () => {
  const head = "name: t\nrules: [CR 117.3d]\n";
  it("refuses rule modifiers it can't read, and an empty abilities list", () => {
    const withRules = (rules: string) => at("main1", `  rules: ${rules}\n`);
    expect(first(`${withRules("{ kind: creaturesGetPT }")}  - p1 pass: once\n`)).toMatch(/rules is a list/);
    expect(first(`${withRules("[{ kind: flying }]")}  - p1 pass: once\n`)).toMatch(/unknown rule modifier/);
    const good = "kind: creaturesGetPT, controller: p1, power: 1, toughness: 1";
    expect(first(`${withRules(`[{ ${good}, extra: 1 }]`)}  - p1 pass: once\n`)).toMatch(/Unknown key "extra"/);
    expect(first(`${withRules(`[{ ${good.replace("p1", "p3")} }]`)}  - p1 pass: once\n`)).toMatch(
      /controller must be p1 or p2/,
    );
    expect(first(`${withRules(`[{ ${good.replace("power: 1", "power: 1.5")} }]`)}  - p1 pass: once\n`)).toMatch(
      /power must be a whole number/,
    );
    const bears = at("main1", "  p1: { battlefield: [Grizzly Bears] }\n");
    expect(first(`${bears}  - expect: { "p1:Grizzly Bears.abilities contains": [] }\n`)).toMatch(/non-empty list/);
    const negative = at("main1", "  p1: { battlefield: [{ card: Grizzly Bears, counters: { +1/+1: -1 } }] }\n");
    expect(first(`${negative}  - p1 pass: once\n`)).toMatch(/can't be negative/);
  });

  it("reports format errors as problems", () => {
    expect(first(`${main1.replace("steps:\n", "stepz:\n")}  - p1 pass: once\n`)).toMatch(
      /Unknown top-level key "stepz"/,
    );
    expect(first(`${main1}  - p1 dance: once\n`)).toMatch(/unknown step word "dance"/);
    expect(first(`${head}setup:\n  turn: { active: p1, step: main1 }\n`)).toMatch(
      /either steps or "expect setup error"/,
    );
    expect(first(`name: t\nrules: [CR 1]\nsetup: {}\nsteps: [{ expect: { turn: 3 } }]\n`)).toMatch(/rules must list/);
    expect(first(`${main1}  - expect: {}\n`)).toMatch(/non-empty map/);
  });

  it("rejects unknown keys and wrong-typed values in the setup", () => {
    const setup = (yaml: string) => first(`${head}setup:\n${yaml}steps: [{ expect: { turn: 3 } }]\n`);
    expect(setup("  turn: { active: p1, step: main1, numbr: 1 }\n")).toMatch(/Unknown key "numbr" in turn/);
    expect(setup("  turn: { active: p1, step: main1 }\n  p1: { hnad: [Forest] }\n")).toMatch(
      /Unknown key "hnad" in p1/,
    );
    expect(
      setup("  turn: { active: p1, step: main1 }\n  p1: { battlefield: [{ card: Forest, tapped: yes }] }\n"),
    ).toMatch(/tapped must be true or false/);
    expect(setup('  turn: { active: p1, step: main1 }\n  p1: { life: "5" }\n')).toMatch(
      /p1.life must be a whole number/,
    );
  });

  it("rejects unknown players and empty expectations", () => {
    expect(first(`${main1}  - expect: { p3.manaPool: {} }\n`)).toMatch(/no player p3/);
    expect(first(`${main1}  - expect: { p3.battlefield: [] }\n`)).toMatch(/no player p3/);
    expect(first(`${main1}  - expect: { p1.lifee: 20 }\n`)).toMatch(/unknown expectation/);
    expect(first(`${main1}  - expect: { pending: {} }\n`)).toMatch(/pending takes a map/);
  });

  it("says when a step or expectation arrives in a later task, keeping a step's options", () => {
    expect(first(`${main1}  - p1 cast: Shock\n    target: [p2]\n`)).toMatch(/"cast" has no option "target"/);
    expect(first(`${main1}  - expect: { "p1:Forest.counters": {} }\n`)).toMatch(/arrives in M1-13/);
  });

  it("checks a rejected setup's reason, which must be given", () => {
    const rejected = `${head}setup:\n  opening: standard\n  p2: { library: [Mountain] }\n`;
    expect(problems(`${rejected}expect setup error: at least 7 cards\n`)).toStrictEqual([]);
    expect(first(`${rejected}expect setup error: something else\n`)).toMatch(/expected "something else"/);
    expect(first(`${rejected}expect setup error: ""\n`)).toMatch(/takes a piece of the expected message/);
  });
});

describe("invariantProblems", () => {
  it("reports a zone entry that isn't an object", () => {
    const empty = {
      life: 20,
      library: [],
      hand: [],
      battlefield: [],
      graveyard: [],
      exile: [],
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
    const created = createGame(
      {
        seed: 1,
        players: [
          { id: "p1", ...empty },
          { id: "p2", ...empty },
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
  // M1-16's acceptance: the documented format matches the runner. Every word the runner knows must appear in backticks
  // in section 1 of testing.md (the scenario format).
  const doc = readFileSync(new URL("../../../docs/testing.md", import.meta.url), "utf8");
  const section = doc.slice(doc.indexOf("## 1. Scenario tests"), doc.indexOf("## 2. The headless CLI"));
  // Code blocks are examples, not the definition: drop them before collecting the backticked words.
  const prose = section.replace(/```[\s\S]*?```/g, "");
  const backticked = [...prose.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? "").join("\n");

  it("documents every word the runner knows", () => {
    const words = [
      ...TOP_KEYS,
      ...SETUP_KEYS,
      ...TURN_KEYS,
      ...PLAYER_KEYS,
      ...PERMANENT_KEYS,
      ...Object.keys(STEP_NAMES),
      ...Object.keys(COMING_STEP_WORDS),
      ...Object.values(STEP_OPTIONS).flat(),
      ...EXPECTATIONS.map((e) => e.replace("pX.", "")),
      ...Object.keys(COMING_EXPECTATIONS),
    ];
    const missing = [...new Set(words)].filter(
      (w) => !new RegExp(`(^|[^\\w])${w.replaceAll(".", "\\.")}([^\\w]|$)`, "m").test(backticked),
    );
    expect(missing).toStrictEqual([]);
  });
});
