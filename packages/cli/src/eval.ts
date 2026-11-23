// `pnpm eval [--deck white-soldiers | all] [--games 500] [--seed 1] [--turn-cap 40] [--vs random]`: how often the
// heuristic AI beats a simple agent with each prebuilt deck, and how long its decisions take (M3-02's acceptance,
// D-145). Prints one line per deck.

import { parseArgs } from "node:util";
import { agentNamed } from "@mtg/ai";
import { cardDatabase, DECKS } from "@mtg/cards";
import { DEFAULT_TURN_CAP, evalReport, runEval } from "./eval/run-eval.ts";
import { wholeNumber } from "./numbers.ts";

export function evaluate(argv: string[]): { output: string; code: number } {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        deck: { type: "string" },
        games: { type: "string" },
        seed: { type: "string" },
        "turn-cap": { type: "string" },
        vs: { type: "string" },
      },
      strict: true,
    });
    const games = wholeNumber(values.games, 500, "games");
    if (games === 0) throw new Error("--games is 1 or more");
    const decks = values.deck === undefined || values.deck === "all" ? Object.keys(DECKS) : [values.deck];
    const cards = cardDatabase();
    const lines = decks.map((deck) => {
      const options = {
        deck,
        games,
        seed: wholeNumber(values.seed, 1, "seed"),
        turnCap: wholeNumber(values["turn-cap"], DEFAULT_TURN_CAP, "turn-cap"),
        opponent: agentNamed(values.vs),
      };
      const line = evalReport(runEval(options, () => performance.now(), cards));
      console.log(line);
      return line;
    });
    return { output: lines.join("\n"), code: 0 };
  } catch (error) {
    return { output: error instanceof Error ? error.message : String(error), code: 1 };
  }
}

if (import.meta.main) {
  const { output, code } = evaluate(process.argv.slice(2));
  if (code !== 0) console.error(output);
  process.exitCode = code;
}
