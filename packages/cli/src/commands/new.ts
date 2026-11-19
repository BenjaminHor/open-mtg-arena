// `new`: start a game from two prebuilt decks (a standard opening, CR 103) or from a scenario's setup.

import { readFileSync } from "node:fs";
import path from "node:path";
import { DECKS, deckLibrary } from "@mtg/cards";
import type { CardDatabase, GameSetup, PlayerId } from "@mtg/engine";
import { buildSetup, parseScenario } from "@mtg/scenarios";
import { newGameFile, writeGameFile } from "../game-file.ts";
import { showGame } from "../show.ts";

/** Where scenario names like `combat/reach-blocks-flyer` are looked up. */
const SCENARIOS = path.join(import.meta.dirname, "../../../engine/test/scenarios");

export type NewOptions = { decks?: string; scenario?: string; seed?: string; first?: string; out?: string };

export function newCommand(options: NewOptions, cards: CardDatabase): string {
  if (options.out === undefined) throw new Error("new needs --out <file>");
  const setup = options.scenario !== undefined ? scenarioSetup(options.scenario, cards) : deckSetup(options);
  const file = newGameFile(setup, cards);
  writeGameFile(options.out, file);
  return file.state === undefined ? "" : showGame(file.state, cards);
}

function deckSetup(options: NewOptions): GameSetup {
  const names = (options.decks ?? "").split(",").filter((n) => n !== "");
  if (names.length !== 2) throw new Error(`new needs --decks <deck>,<deck>; decks: ${Object.keys(DECKS).join(", ")}`);
  const seed = options.seed === undefined ? 1 : Number(options.seed);
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error("--seed is a whole number, 0 or more");
  const first = options.first;
  if (first !== undefined && first !== "p1" && first !== "p2") throw new Error("--first is p1 or p2");
  const players = names.map((name, i) => {
    const deck = DECKS[name];
    if (deck === undefined) throw new Error(`No deck "${name}"; decks: ${Object.keys(DECKS).join(", ")}`);
    return {
      id: `p${i + 1}` as PlayerId,
      life: 20,
      library: deckLibrary(deck),
      hand: [],
      battlefield: [],
      graveyard: [],
      exile: [],
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
  });
  return {
    seed,
    players,
    opening: { kind: "standard", firstPlayer: (first ?? null) as PlayerId | null },
    ruleModifiers: [],
  };
}

/** A scenario's setup: by path to a `.yaml` file, or by name under the engine's scenarios. */
function scenarioSetup(name: string, cards: CardDatabase): GameSetup {
  const file = name.endsWith(".yaml") ? name : path.join(SCENARIOS, `${name}.yaml`);
  return buildSetup(parseScenario(readFileSync(file, "utf8")).setup, cards);
}
