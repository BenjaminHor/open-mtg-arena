// Golden games (docs/testing.md, section 4): full games between agents, each stored as its recipe and actions
// (`<name>.json`, a game file `pnpm cli replay` opens) and its readable event log (`<name>.log`). The test replays the
// actions and compares the log line by line, so an engine change shows as a readable diff ("T6 Giant Spider now
// survives"). `pnpm golden:update` rewrites them after an intended change; `pnpm golden:add` adds one.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { cardDatabase, DECKS, type DeckList } from "@mtg/cards";
import { type Action, type CardDatabase, createGame, ENGINE_VERSION, type GameSetup } from "@mtg/engine";
import { playAgents } from "./agent-play.ts";
import { type AgentName, agentNamed } from "./agents.ts";
import { deckGameSetup } from "./deck-setup.ts";
import { logUntilRejected } from "./event-log.ts";
import { actionPerLineText, decodeStored, encodeLines, FORMAT, replay } from "./game-file.ts";
import { wholeNumber } from "./numbers.ts";

export const GOLDEN_DIR = join(import.meta.dirname, "../../engine/test/golden");

/**
 * How the game was made. Playing it again gives the stored actions until an engine change alters what the agents see;
 * `pnpm golden:update` keeps actions that still play out, and says when the recipe no longer gives them.
 */
export type GoldenRecipe = { setup: GameSetup; agent: AgentName; agentSeed: number; maxTurns: number };

export type GoldenGame = GoldenRecipe & {
  format: typeof FORMAT;
  version: number;
  description: string;
  actions: Action[];
  /** Read back only: stored action lines left after the game ended, as an engine change can end it sooner (D-082). */
  unread?: number;
};

/** The agents play every player from the setup, until the game ends or passes `maxTurns`. */
export function playRecipe(recipe: GoldenRecipe, cards: CardDatabase): Action[] {
  const created = createGame(recipe.setup, cards);
  if (!created.ok) throw new Error(`the setup is rejected: ${created.error.message}`);
  const limits = { maxActions: 100_000, maxTurns: recipe.maxTurns };
  const played = playAgents(created.state, () => true, recipe.agent, recipe.agentSeed, limits, cards);
  // Any other stop would leave a game that never plays out "the same", and would be played again on every update.
  if (played.stopped !== "gameOver" && played.stopped !== "maxTurns") {
    throw new Error(`the game stopped at ${played.stopped}, not at its end or its turn cap`);
  }
  return played.actions;
}

/**
 * The game's log, brief (no priority passes or steps beginning), one event per line. If an action is now rejected,
 * the log stops there with a line saying so, so the diff shows where the game went differently.
 */
export function goldenLog(game: GoldenGame, cards: CardDatabase): string {
  const { lines, rejected } = logUntilRejected(game.setup, game.actions, cards, true);
  return `${[...lines, ...(rejected === null ? [] : [`!! ${rejected}`])].join("\n")}\n`;
}

/** The golden game's file: its recipe, then setup and actions in the compact encoding (D-082). */
export function goldenText(game: GoldenGame, cards: CardDatabase): string {
  const { format, version, description, agent, agentSeed, maxTurns } = game;
  const { encoding, setup, actions } = encodeLines(game.setup, game.actions, cards);
  return actionPerLineText({ format, version, description, agent, agentSeed, maxTurns, encoding, setup }, actions);
}

export function goldenFiles(dir = GOLDEN_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => join(dir, f));
}

/** A golden game, in either encoding (D-082). */
export function readGolden(path: string, cards: CardDatabase): GoldenGame {
  const raw = JSON.parse(readFileSync(path, "utf8")) as GoldenGame & { encoding?: "lines" };
  if (raw.format !== FORMAT) throw new Error(`${path} isn't a game file`);
  // Without these, playing the recipe again would run without a turn cap.
  if (typeof raw.agentSeed !== "number" || typeof raw.maxTurns !== "number" || typeof raw.agent !== "string") {
    throw new Error(`${path} has no recipe: it needs agent, agentSeed and maxTurns`);
  }
  const { encoding: _, ...game } = raw;
  const { setup, actions, unread } = decodeStored(raw, cards);
  return { ...game, setup, actions, ...(unread === 0 ? {} : { unread }) };
}

export const logPath = (jsonPath: string): string => jsonPath.replace(/\.json$/, ".log");

/**
 * Rewrites every golden game from the current engine. Its actions stay if they still play out to where the game
 * stopped; otherwise (an action is rejected, or the game no longer ends there) it's played again from its recipe.
 * Returns one line per game that changed, saying what and why, for the commit message. Games are written one at a
 * time: if one throws, those before it are already rewritten (git shows them).
 */
export function updateGoldens(dir: string, cards: CardDatabase): string[] {
  const report: string[] = [];
  for (const path of goldenFiles(dir)) {
    const old = readGolden(path, cards);
    const fromRecipe = playRecipe(old, cards);
    const problem = playOutProblem(old, cards);
    const game: GoldenGame = { ...old, version: ENGINE_VERSION, actions: problem === null ? old.actions : fromRecipe };
    const changes: string[] = [];
    if (problem !== null)
      changes.push(`played again from its recipe (${problem}; ${actionsDiffer(old.actions, game.actions)})`);
    else if (!sameActions(fromRecipe, old.actions)) {
      changes.push(`actions kept; the recipe now plays differently (${actionsDiffer(old.actions, fromRecipe)})`);
    }
    if (writeIfChanged(logPath(path), goldenLog(game, cards))) changes.push("log changed");
    const fileChanged = writeIfChanged(path, goldenText(game, cards));
    // With the same actions, a changed file means only its version or its layout changed.
    if (fileChanged && problem === null) changes.push("file rewritten (version or layout)");
    if (changes.length > 0) report.push(`${path}: ${changes.join(", ")}`);
  }
  return report;
}

/** Why the stored actions don't play out to where the recipe stops the game, or null when they do. */
function playOutProblem(game: GoldenGame, cards: CardDatabase): string | null {
  let state: ReturnType<typeof replay>["state"];
  try {
    state = replay(game.setup, game.actions, cards).state;
  } catch (error) {
    // A rejected action, the likelier reason the stored lines stop early.
    return error instanceof Error ? error.message : String(error);
  }
  if ((game.unread ?? 0) > 0) return `the game now ends ${game.unread} stored action lines sooner`;
  if (state.result !== null || (state.turn?.number ?? 0) > game.maxTurns) return null;
  return "the game no longer ends where it did";
}

const sameActions = (a: readonly Action[], b: readonly Action[]) => JSON.stringify(a) === JSON.stringify(b);

function actionsDiffer(before: readonly Action[], after: readonly Action[]): string {
  if (sameActions(before, after)) return "the same actions";
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

/** The decks, seeds, agent and turn cap of a game to add, and its file's name and description. */
export type NewGolden = {
  decks: DeckList[];
  seed: number;
  agent: AgentName;
  agentSeed: number;
  maxTurns: number;
  name: string;
  description: string;
};

/** Plays and writes a new golden game. Returns its path. */
export function addGolden(options: NewGolden, dir: string, cards: CardDatabase): string {
  const recipe: GoldenRecipe = {
    setup: deckGameSetup(options.decks, options.seed, null),
    agent: options.agent,
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
  if (existsSync(path)) throw new Error(`${path} exists; pnpm golden:update regenerates it`);
  writeFileSync(path, goldenText(game, cards));
  writeFileSync(logPath(path), goldenLog(game, cards));
  return path;
}

/**
 * `pnpm golden:add --decks red-aggro,green-stompy --seed 3 [--agent by-kind] [--agent-seed N] [--max-turns 200]
 * [--name ...]`.
 */
function addCommand(argv: string[], cards: CardDatabase): string {
  const text = { type: "string" } as const;
  const { values } = parseArgs({
    args: argv,
    options: {
      decks: text,
      seed: text,
      agent: text,
      "agent-seed": text,
      "max-turns": text,
      name: text,
      description: text,
    },
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
  const agent = agentNamed(option("agent") ?? "by-kind");
  const description = option("description") ?? `${names.join(" against ")}, setup seed ${seed}, ${agent} agents.`;
  const path = addGolden(
    {
      decks,
      seed,
      agent,
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
