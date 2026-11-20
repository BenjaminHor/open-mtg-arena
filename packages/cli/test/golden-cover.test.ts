// `pnpm golden:cover` (D-069): what a game covers, and the greedy choice of games.

import { cardDatabase, DECKS, type DeckList } from "@mtg/cards";
import { describe, expect, it } from "vitest";
import { deckGameSetup } from "../src/deck-setup.ts";
import { playRecipe } from "../src/golden.ts";
import { type Candidate, type Coverage, chooseCover, coverageOf } from "../src/golden-cover.ts";

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

  it("finds each card used, played as a land or resolved, in the turn it's first used", () => {
    const actions = playRecipe({ setup, agent: "by-kind", agentSeed: 5, maxTurns: 8 }, cards);
    const { firstTurn } = coverageOf(setup, actions, cards);
    expect(firstTurn.Mountain).toBeTypeOf("number");
    expect(firstTurn.Forest).toBeTypeOf("number");
    // Each card's turn is when it's first used: cut off there, the game still uses it.
    for (const [card, turn] of Object.entries(firstTurn)) {
      const cut = playRecipe({ setup, agent: "by-kind", agentSeed: 5, maxTurns: turn }, cards);
      expect(coverageOf(setup, cut, cards).firstTurn[card], card).toBe(turn);
    }
  });
});
