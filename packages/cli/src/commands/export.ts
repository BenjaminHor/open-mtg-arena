// `export <file> --scenario [--name ...] [--rules "CR 510.1c,CR 702.9b"]`: the game so far as a scenario, to keep a
// path checked (docs/testing.md). The final `expect` is built from where the game ended up; check it says what should
// be true, and list the rules it proves.

import type { CardDatabase } from "@mtg/engine";
import { runScenario, scenarioFromGame } from "@mtg/scenarios";
import { readGameFile } from "../game-file.ts";

export function exportCommand(
  file: string,
  options: { scenario?: boolean; name?: string | undefined; rules?: string | undefined },
  cards: CardDatabase,
): string {
  if (options.scenario !== true) throw new Error("export needs --scenario (the one format so far)");
  const game = readGameFile(file);
  // The format needs at least one rule. Without --rules, CR 100.1 ("these rules apply to any Magic game") stands in;
  // replace it with what the scenario proves.
  const rules = (options.rules ?? "CR 100.1").split(",").map((r) => r.trim());
  const name = options.name ?? "Exported game (describe what it proves)";
  const yaml = scenarioFromGame(name, rules, game.setup, game.actions, cards);
  // A wrong export must not go out silently: the scenario has to pass before it's printed.
  const problems = runScenario(yaml, cards).problems;
  if (problems.length > 0)
    throw new Error(`the exported scenario doesn't pass (an exporter bug): ${problems.join("; ")}`);
  return yaml.trimEnd();
}
