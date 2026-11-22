// `pnpm golden:cover` (D-069): what a game covers, and the greedy choice of games.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cardDatabase, DECKS, type DeckList } from "@mtg/cards";
import type { Action, GameEvent, GameState, ObjectId, PlayerId } from "@mtg/engine";
import { deckGameSetup } from "@mtg/match";
import { afterEach, describe, expect, it } from "vitest";
import { fuzzDecks } from "../src/fuzz/run-game.ts";
import { addGolden, goldenFiles, playRecipe } from "../src/golden.ts";
import {
  addCover,
  type Candidate,
  type Coverage,
  chooseCover,
  coverageOf,
  FEATURES,
  featuresOf,
  mechanicsUsed,
} from "../src/golden-cover.ts";

const cards = cardDatabase();

/** A made-up candidate: units by first turn, and a game ten actions a turn long. */
function candidate(seed: number, firstTurn: Record<string, number>): Candidate {
  const coverage: Coverage = { firstTurn, lengthThrough: Array.from({ length: 30 }, (_, t) => t * 10) };
  return { seed, coverage };
}

describe("chooseCover", () => {
  it("takes the game adding the most uncovered units per action, cut off at its last new unit's turn", () => {
    const candidates = [
      candidate(1, { A: 2, B: 20 }), // both: 2 units in 200 actions
      candidate(2, { A: 3 }), // 1 unit in 30
      candidate(3, { B: 5, C: 5 }), // 2 units in 50: the best rate
    ];
    // Once B is covered, the first game adds only A, so it's cut off at turn 2: 1 unit in 20 beats 1 in 30.
    expect(chooseCover(candidates, [])).toStrictEqual([
      { seed: 3, maxTurns: 5, length: 50, adds: ["B", "C"] },
      { seed: 1, maxTurns: 2, length: 20, adds: ["A"] },
    ]);
  });

  it("counts what's already covered, breaks ties by the lower seed, and stops when nothing adds anything", () => {
    const candidates = [candidate(4, { A: 1, B: 4 }), candidate(3, { B: 4 }), candidate(5, { A: 1 })];
    expect(chooseCover(candidates, ["A"])).toStrictEqual([{ seed: 3, maxTurns: 4, length: 40, adds: ["B"] }]);
    expect(chooseCover(candidates, ["A", "B"])).toStrictEqual([]);
  });
});

describe("coverageOf", () => {
  const decks = [DECKS["red-aggro"], DECKS["green-stompy"]] as DeckList[];
  const setup = deckGameSetup(decks, 5, null);

  it("says how long the game is when cut off at each turn, as the recipe's turn cap cuts it", () => {
    const actions = playRecipe({ setup, agent: "by-kind", agentSeed: 5, maxTurns: 8 }, cards);
    const { lengthThrough } = coverageOf(setup, actions, cards);
    for (let turn = 1; turn <= 7; turn++) {
      const cut = playRecipe({ setup, agent: "by-kind", agentSeed: 5, maxTurns: turn }, cards);
      expect(lengthThrough[turn], `turn ${turn}`).toBe(cut.length);
    }
  });

  it("finds each mechanic run and decision answered, in the turn it first appears", () => {
    const actions = playRecipe({ setup, agent: "by-kind", agentSeed: 5, maxTurns: 8 }, cards);
    const { firstTurn } = coverageOf(setup, actions, cards);
    expect(firstTurn["decision priority"]).toBeTypeOf("number");
    expect(firstTurn["effect dealDamage"]).toBeTypeOf("number");
    // Each unit's turn is when it first appears: cut off there, the game still has it.
    for (const [unit, turn] of Object.entries(firstTurn)) {
      const cut = playRecipe({ setup, agent: "by-kind", agentSeed: 5, maxTurns: turn }, cards);
      expect(coverageOf(setup, cut, cards).firstTurn[unit], unit).toBe(turn);
    }
  });
});

const oracleIdOf = (name: string) => Object.values(cards).find((c) => c.printed.name === name)?.oracleId;

/** Just enough of a state for naming objects: a few cards and one ability, a stack and graveyards. */
function fakeState(): GameState {
  const card = (name: string) => ({ kind: "card", oracleId: oracleIdOf(name) });
  return {
    objects: {
      bolt: card("Lightning Bolt"),
      elves: card("Llanowar Elves"),
      forest: card("Forest"),
      bears: card("Grizzly Bears"),
      shot: {
        kind: "ability",
        sourceOracleId: oracleIdOf("Prodigal Pyromancer"),
        ability: { kind: "printed", index: 0 },
      },
    },
    zones: {
      stack: ["bolt"],
      players: { p1: { graveyard: ["bears"] }, p2: { graveyard: [] } },
    },
  } as unknown as GameState;
}

describe("mechanicsUsed", () => {
  const state = fakeState();
  const used = (event: object) => mechanicsUsed(event as GameEvent, state, state, cards);
  const p1 = "p1" as PlayerId;

  it("sees a spell resolved, an ability resolved and mana made run their card's mechanics", () => {
    expect(used({ type: "SPELL_RESOLVED", object: "bolt", cardId: "c2", controller: p1 })).toStrictEqual([
      "target anyTarget",
      "effect dealDamage",
    ]);
    expect(used({ type: "ABILITY_RESOLVED", object: "shot", source: "gone", controller: p1 })).toStrictEqual([
      "cost tap",
      "target anyTarget",
      "effect dealDamage",
    ]);
    expect(used({ type: "MANA_ADDED", player: p1, mana: "G", amount: 1, source: "elves" })).toStrictEqual([
      "cost tap",
      "effect addMana",
    ]);
  });

  it("sees nothing in a land played, or a cast that's cancelled, countered or doesn't resolve: no script ran", () => {
    expect(used({ type: "LAND_PLAYED", player: p1, newId: "forest", cardId: "c1" })).toStrictEqual([]);
    expect(used({ type: "SPELL_CAST", player: p1, object: "bolt", cardId: "c2" })).toStrictEqual([]);
    expect(
      used({ type: "CAST_CANCELLED", player: p1, spell: "bolt", cardId: "c2", restored: "x", untapped: [] }),
    ).toStrictEqual([]);
    expect(used({ type: "SPELL_COUNTERED", object: "bolt", cardId: "c2" })).toStrictEqual([]);
    expect(used({ type: "SPELL_DID_NOT_RESOLVE", object: "bolt", cardId: "c2" })).toStrictEqual([]);
  });
});

describe("featuresOf", () => {
  const state = fakeState();
  const answer = (answer: object) => featuresOf(state, { type: "ANSWER", answer } as unknown as Action);
  const target = (object: string) => ({ kind: "chooseTarget", target: { kind: "object", object: object as ObjectId } });

  it("sees a spell on the stack targeted, a card in a graveyard targeted, and cards chosen", () => {
    expect(answer(target("bolt"))).toStrictEqual([FEATURES.stackTarget]);
    expect(answer(target("bears"))).toStrictEqual([FEATURES.graveyardTarget]);
    expect(answer({ kind: "chooseCard", option: 0 })).toStrictEqual([FEATURES.cardsChosen]);
  });

  it("sees nothing in other targets and answers", () => {
    expect(answer(target("elves"))).toStrictEqual([]);
    expect(answer({ kind: "chooseTarget", target: { kind: "player", player: "p2" } })).toStrictEqual([]);
    expect(answer({ kind: "finishChoosing" })).toStrictEqual([]);
  });
});

describe("addCover", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("adds games for what's not covered, says what's still missing, and leaves a seed whose game exists alone", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mtg-cover-"));
    dirs.push(dir);
    // pool-793 already exists, cut off at turn 1: it isn't played again or overwritten.
    const decks = fuzzDecks(793);
    addGolden(
      { decks, seed: 793, agent: "by-kind", agentSeed: 793, maxTurns: 1, name: "pool-793", description: "" },
      dir,
      cards,
    );
    const { added, missing } = addCover(dir, [791, 793, 795], cards);
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((line) => /pool-79[15]\.json: \d+ actions, adds /.test(line))).toBe(true);
    expect(goldenFiles(dir).map((f) => path.basename(f))).toStrictEqual(
      ["pool-793.json", ...added.map((line) => path.basename(line.split(":")[0] as string))].sort(),
    );
    // Three games can't use the whole pool.
    expect(missing.length).toBeGreaterThan(0);
    expect(addCover(dir, [791, 793, 795], cards).added).toStrictEqual([]);
  }, 30_000); // Plays whole games: seconds alone, longer beside the rest of the suite.
});
