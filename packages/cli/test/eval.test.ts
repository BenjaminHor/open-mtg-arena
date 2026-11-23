// `pnpm eval` (D-145) in miniature: a few fixed games per prebuilt deck, so a change that makes the heuristic AI much
// worse fails `pnpm check`. The acceptance bar (95% of 500 games per deck) is measured with `pnpm eval` itself.

import { cardDatabase, DECKS } from "@mtg/cards";
import { describe, expect, it } from "vitest";
import { runEval } from "../src/eval/run-eval.ts";

const GAMES = 10;
/**
 * Seeds 101-110: at seed 1, one red-green-beats game has the random agent go round in circles under Prized Unicorn's
 * requirement until the host gives up (void, and slow): its known loop, not the heuristic's (status.md, Known issues).
 */
const SEED = 101;
/** Looser than the acceptance bar: ten games say little, but losing more than three to random play is a regression. */
const AT_LEAST = 7;

describe("the heuristic AI beats the random agent with each prebuilt deck", () => {
  const cards = cardDatabase();
  for (const deck of Object.keys(DECKS)) {
    it(deck, () => {
      const summary = runEval({ deck, games: GAMES, seed: SEED, turnCap: 40, opponent: "random" }, () => 0, cards);
      expect(summary.counts.won).toBeGreaterThanOrEqual(AT_LEAST);
      expect(summary.decisions).toBeGreaterThan(0);
      // None of these games has the host give up (D-145): a void here would hide a loop.
      expect(summary.counts.void).toBe(0);
    });
  }
});
