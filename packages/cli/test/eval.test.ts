// `pnpm eval` (D-145) in miniature: a few fixed games per prebuilt deck, so a change that makes the heuristic AI much
// worse fails `pnpm check`. The acceptance bar (95% of 500 games per deck) is measured with `pnpm eval` itself.

import { cardDatabase, DECKS } from "@mtg/cards";
import { describe, expect, it } from "vitest";
import { runEval } from "../src/eval/run-eval.ts";

const GAMES = 10;
/** Looser than the acceptance bar: ten games say little, but losing more than three to random play is a regression. */
const AT_LEAST = 7;

describe("the heuristic AI beats the random agent with each prebuilt deck", () => {
  const cards = cardDatabase();
  for (const deck of Object.keys(DECKS)) {
    it(deck, () => {
      const summary = runEval({ deck, games: GAMES, seed: 1, turnCap: 40, opponent: "random" }, () => 0, cards);
      expect(summary.counts.won).toBeGreaterThanOrEqual(AT_LEAST);
      expect(summary.decisions).toBeGreaterThan(0);
    });
  }
});
