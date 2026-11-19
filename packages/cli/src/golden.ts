// Golden games (docs/testing.md, section 4): full games between agents, each stored as its recipe and actions
// (`<name>.json`, a game file `pnpm cli replay` opens) and its readable event log (`<name>.log`). The test replays the
// actions and compares the log line by line, so an engine change shows as a readable diff ("T6 Giant Spider now
// survives"). `pnpm golden:update` rewrites them after an intended change; `pnpm golden:add` adds one.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { cardDatabase, DECKS, type DeckList } from "@mtg/cards";
import { type Action, type CardDatabase, createGame, ENGINE_VERSION, type GameSetup } from "@mtg/engine";
import { playAgents } from "./agent-play.ts";
import type { AgentName } from "./agents.ts";
import { deckGameSetup } from "./deck-setup.ts";
import { logUntilRejected } from "./event-log.ts";
import { actionPerLineText, FORMAT, replay } from "./game-file.ts";
import { wholeNumber } from "./numbers.ts";

export const GOLDEN_DIR = join(import.meta.dirname, "../../engine/test/golden");

/** How the game was made: replaying it from here gives the same actions, as long as the engine doesn't change. */
export type GoldenRecipe = { setup: GameSetup; agent: AgentName; agentSeed: number; maxTurns: number };

export type GoldenGame = GoldenRecipe & {
  format: typeof FORMAT;
  version: number;
  description: string;
  actions: Action[];
};

/** The agents play every player from the setup, until the game ends or passes `maxTurns`. */
export function playRecipe(recipe: GoldenRecipe, cards: CardDatabase): Action[] {
  const created = createGame(recipe.setup, cards);
  if (!created.ok) throw new Error(`the setup is rejected: ${created.error.message}`);
  const limits = { maxActions: 100_000, maxTurns: recipe.maxTurns };
  return playAgents(created.state, () => true, recipe.agent, recipe.agentSeed, limits, cards).actions;
}

/**
 * The game's log, brief (no priority passes or steps beginning), one event per line. If an action is now rejected,
 * the log stops there with a line saying so, so the diff shows where the game went differently.
 */
export function goldenLog(game: GoldenGame, cards: CardDatabase): string {
  const { lines, rejected } = logUntilRejected(game.setup, game.actions, cards, true);
  return `${[...lines, ...(rejected === null ? [] : [`!! ${rejected}`])].join("\n")}\n`;
}

export function goldenText(game: GoldenGame): string {
  const { format, version, description, agent, agentSeed, maxTurns, setup } = game;
  return actionPerLineText({ format, version, description, agent, agentSeed, maxTurns, setup }, game.actions);
}

export function goldenFiles(dir = GOLDEN_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => join(dir, f));
}

export function readGolden(path: string): GoldenGame {
  const game = JSON.parse(readFileSync(path, "utf8")) as GoldenGame;
  if (game.format !== FORMAT) throw new Error(`${path} isn't a game file`);
  return game;
}

export const logPath = (jsonPath: string): string => jsonPath.replace(/\.json$/, ".log");

/**
 * Rewrites every golden game from the current engine. Its actions stay if they still play out to where the game
 * stopped; otherwise (an action is rejected, or the game no longer ends there) it's played again from its recipe.
 * Returns one line per game that changed, saying which, for the commit message.
 */
export function updateGoldens(dir: string, cards: CardDatabase): string[] {
  const report: string[] = [];
  for (const path of goldenFiles(dir)) {
    const old = readGolden(path);
    const stillPlays = playsOutTheSame(old, cards);
    const game: GoldenGame = {
      ...old,
      version: ENGINE_VERSION,
      actions: stillPlays ? old.actions : playRecipe(old, cards),
    };
    const changes: string[] = [];
    if (!stillPlays) changes.push(`played again from its recipe (${actionsDiffer(old.actions, game.actions)})`);
    if (writeIfChanged(logPath(path), goldenLog(game, cards))) changes.push("log changed");
    if (writeIfChanged(path, goldenText(game)) && stillPlays) changes.push("file rewritten");
    if (changes.length > 0) report.push(`${path}: ${changes.join(", ")}`);
  }
  return report;
}

/** Whether the stored actions are all accepted and leave the game where the recipe would stop it. */
function playsOutTheSame(game: GoldenGame, cards: CardDatabase): boolean {
  try {
    const { state } = replay(game.setup, game.actions, cards);
    return state.result !== null || (state.turn?.number ?? 0) > game.maxTurns;
  } catch {
    return false;
  }
}

function actionsDiffer(before: readonly Action[], after: readonly Action[]): string {
  const first = after.findIndex((a, i) => JSON.stringify(a) !== JSON.stringify(before[i]));
  const at = first === -1 ? Math.min(before.length, after.length) : first;
  return `actions differ from action ${at + 1}: ${before.length} before, ${after.length} now`;
}

function writeIfChanged(path: string, text: string): boolean {
  let old: string | null = null;
  try {
    old = readFileSync(path, "utf8");
  } catch {
    // A new file.
  }
  if (old === text) return false;
  writeFileSync(path, text);
  return true;
}

/** Plays and writes a new golden game between prebuilt decks. Returns its path. */
export function addGolden(
  options: { decks: DeckList[]; seed: number; agentSeed: number; maxTurns: number; name: string; description: string },
  dir: string,
  cards: CardDatabase,
): string {
  const recipe: GoldenRecipe = {
    setup: deckGameSetup(options.decks, options.seed, null),
    agent: "random",
    agentSeed: options.agentSeed,
    maxTurns: options.maxTurns,
  };
  const game: GoldenGame = {
    format: FORMAT,
    version: ENGINE_VERSION,
    description: options.description,
    ...recipe,
    actions: playRecipe(recipe, cards),
  };
  const path = join(dir, `${options.name}.json`);
  writeFileSync(path, goldenText(game));
  writeFileSync(logPath(path), goldenLog(game, cards));
  return path;
}

/** `pnpm golden:add --decks red-aggro,green-stompy --seed 3 [--agent-seed N] [--max-turns 200] [--name ...]`. */
function addCommand(argv: string[], cards: CardDatabase): string {
  const text = { type: "string" } as const;
  const { values } = parseArgs({
    args: argv,
    options: { decks: text, seed: text, "agent-seed": text, "max-turns": text, name: text, description: text },
    strict: true,
  });
  const option = (name: keyof typeof values): string | undefined => values[name];
  const names = (option("decks") ?? "").split(",").filter((n) => n !== "");
  if (names.length < 2) throw new Error("--decks names two prebuilt decks, like red-aggro,green-stompy");
  const decks = names.map((n) => {
    const deck = DECKS[n];
    if (deck === undefined) throw new Error(`no prebuilt deck ${n}: ${Object.keys(DECKS).join(", ")}`);
    return deck;
  });
  const seed = wholeNumber(option("seed"), 1, "seed");
  const name = option("name") ?? `${names.join("-vs-")}-${seed}`;
  const description = option("description") ?? `${names.join(" against ")}, setup seed ${seed}, random agents.`;
  const path = addGolden(
    {
      decks,
      seed,
      agentSeed: wholeNumber(option("agent-seed"), seed, "agent-seed"),
      maxTurns: wholeNumber(option("max-turns"), 200, "max-turns"),
      name,
      description,
    },
    GOLDEN_DIR,
    cards,
  );
  return `added ${path} and its log`;
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === "update") {
      const report = updateGoldens(GOLDEN_DIR, cardDatabase());
      console.log(report.length === 0 ? "every golden game is up to date" : report.join("\n"));
    } else if (command === "add") {
      console.log(addCommand(rest, cardDatabase()));
    } else {
      throw new Error("usage: golden.ts update | add --decks a,b --seed N");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
