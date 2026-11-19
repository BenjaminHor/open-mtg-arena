// `pnpm fuzz`: many fuzzed games, one per seed, from a starting seed. Each failure is written out as a game file.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CardDatabase } from "@mtg/engine";
import { writeGameFile } from "../game-file.ts";
import { ALL_CHECKS, type Check } from "./checks.ts";
import { fuzzGame, TURN_CAP } from "./run-game.ts";

export type FuzzOptions = {
  games: number;
  /** Game i plays seed `seed + i`, so `--games 1 --seed <that>` reruns one game. */
  seed: number;
  turnCap?: number;
  /** Where failures are written; created if missing. */
  outDir: string;
  checks?: readonly Check[];
};

export type FuzzSummary = { games: number; failures: { seed: number; problem: string; file: string }[] };

export function runFuzz(options: FuzzOptions, cards: CardDatabase): FuzzSummary {
  const failures: FuzzSummary["failures"] = [];
  for (let i = 0; i < options.games; i++) {
    const seed = options.seed + i;
    const result = fuzzGame(seed, options.checks ?? ALL_CHECKS, cards, options.turnCap ?? TURN_CAP);
    if (result.ok) continue;
    mkdirSync(options.outDir, { recursive: true });
    const file = join(options.outDir, `seed-${seed}.json`);
    writeGameFile(file, result.file);
    failures.push({ seed, problem: result.problem, file });
  }
  return { games: options.games, failures };
}

/** The report: one line per failure, with how to look at it and how to rerun it. */
export function fuzzReport(summary: FuzzSummary, firstSeed: number): string {
  const last = firstSeed + summary.games - 1;
  const head = `${summary.games} games, seeds ${firstSeed}–${last}: ${summary.failures.length} failed`;
  const lines = summary.failures.map(
    (f) => `  seed ${f.seed}: ${f.problem}\n    pnpm cli replay ${f.file}\n    pnpm fuzz --games 1 --seed ${f.seed}`,
  );
  return [head, ...lines].join("\n");
}
