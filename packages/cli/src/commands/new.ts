// `new`: start a game from two prebuilt decks (a standard opening, CR 103) or from a scenario's setup.

import { readFileSync } from "node:fs";
import path from "node:path";
import { DECKS } from "@mtg/cards";
import type { CardDatabase, GameSetup, PlayerId } from "@mtg/engine";
import { buildSetup, parseScenario } from "@mtg/scenarios";
import { deckGameSetup } from "../deck-setup.ts";
import { newGameFile, writeGameFile } from "../game-file.ts";
import { wholeNumber } from "../numbers.ts";
import { showGame } from "../show.ts";

/** Where scenario names like `combat/reach-blocks-flyer` are looked up. */
const SCENARIOS = path.join(import.meta.dirname, "../../../engine/test/scenarios");

export type NewOptions = {
  decks?: string | undefined;
  scenario?: string | undefined;
  seed?: string | undefined;
  first?: string | undefined;
  out?: string | undefined;
};

export function newCommand(options: NewOptions, cards: CardDatabase): string {
  if (options.out === undefined) throw new Error("new needs --out <file>");
  const deckOptions = options.decks !== undefined || options.seed !== undefined || options.first !== undefined;
  if (options.scenario !== undefined && deckOptions) {
    throw new Error("new --scenario takes its setup from the scenario: no --decks, --seed or --first");
  }
  const setup = options.scenario !== undefined ? scenarioSetup(options.scenario, cards) : deckSetup(options);
  const file = newGameFile(setup, cards);
  writeGameFile(options.out, file);
  return file.state === undefined ? "" : showGame(file.state, cards);
}

function deckSetup(options: NewOptions): GameSetup {
  const names = (options.decks ?? "").split(",").filter((n) => n !== "");
  if (names.length !== 2) throw new Error(`new needs --decks <deck>,<deck>; decks: ${Object.keys(DECKS).join(", ")}`);
  const seed = wholeNumber(options.seed, 1, "seed");
  const first = options.first;
  if (first !== undefined && first !== "p1" && first !== "p2") throw new Error("--first is p1 or p2");
  const decks = names.map((name) => {
    const deck = DECKS[name];
    if (deck === undefined) throw new Error(`No deck "${name}"; decks: ${Object.keys(DECKS).join(", ")}`);
    return deck;
  });
  return deckGameSetup(decks, seed, (first ?? null) as PlayerId | null);
}

/** A scenario's setup: by path to a `.yaml` file, or by name under the engine's scenarios. */
function scenarioSetup(name: string, cards: CardDatabase): GameSetup {
  const file = name.endsWith(".yaml") ? name : path.join(SCENARIOS, `${name}.yaml`);
  return buildSetup(parseScenario(readFileSync(file, "utf8")).setup, cards);
}
