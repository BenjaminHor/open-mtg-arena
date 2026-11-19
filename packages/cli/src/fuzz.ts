// `pnpm fuzz --games N --seed S [--turn-cap T] [--out dir]`: random legal games checked after every action
// (docs/testing.md, section 3). Exits 1 if any game fails; each failure is written to fuzz-failures/.

import { parseArgs } from "node:util";
import { cardDatabase } from "@mtg/cards";
import { fuzzReport, runFuzz } from "./fuzz/run-fuzz.ts";
import { TURN_CAP } from "./fuzz/run-game.ts";
import { wholeNumber } from "./numbers.ts";

/** Runs the fuzzer. Never throws: a problem is reported as output with code 1. */
export function fuzz(argv: string[], defaultSeed: number): { output: string; code: number } {
  let seed: number | null = null;
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        games: { type: "string" },
        seed: { type: "string" },
        "turn-cap": { type: "string" },
        out: { type: "string" },
      },
      strict: true,
    });
    const games = wholeNumber(values.games, 100, "games");
    if (games === 0) throw new Error("--games is 1 or more");
    seed = wholeNumber(values.seed, defaultSeed, "seed");
    const summary = runFuzz(
      {
        games,
        seed,
        turnCap: wholeNumber(values["turn-cap"], TURN_CAP, "turn-cap"),
        outDir: values.out ?? "fuzz-failures",
      },
      cardDatabase(),
    );
    return { output: fuzzReport(summary, seed), code: summary.failures.length === 0 ? 0 : 1 };
  } catch (error) {
    // A problem outside any one game (writing a failure file, say); with the starting seed, so the run can be repeated.
    const text = error instanceof Error ? error.message : String(error);
    return { output: seed === null ? text : `${text} (the run started at seed ${seed})`, code: 1 };
  }
}

if (import.meta.main) {
  // Without --seed, a new seed each run, so runs explore different games; the report prints it to rerun.
  const { output, code } = fuzz(process.argv.slice(2), Date.now() % 1_000_000_000);
  if (code === 0) console.log(output);
  else console.error(output);
  process.exitCode = code;
}
