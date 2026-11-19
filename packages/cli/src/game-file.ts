// The game file every command reads and writes (docs/testing.md, section 2). The setup and the actions taken are the
// truth: replaying them reproduces the game exactly (the engine is deterministic). `state` is only a cache, so a long
// game isn't replayed by every command. The same file is the replay log and the bug-report format.

import { readFileSync, writeFileSync } from "node:fs";
import {
  type Action,
  applyAction,
  type CardDatabase,
  createGame,
  ENGINE_VERSION,
  type GameEvent,
  type GameSetup,
  type GameState,
} from "@mtg/engine";

export const FORMAT = "open-mtg-arena game";

export type GameFile = {
  format: typeof FORMAT;
  version: number;
  setup: GameSetup;
  actions: Action[];
  /** The state after all the actions, if cached. Optional: a replay log or bug report needs only setup and actions. */
  state?: GameState;
};

export type Replayed = { state: GameState; events: GameEvent[] };

/** Plays the game from its setup through the first `upTo` actions. Throws if the setup or an action is rejected. */
export function replay(
  setup: GameSetup,
  actions: readonly Action[],
  cards: CardDatabase,
  upTo = actions.length,
): Replayed {
  const created = createGame(setup, cards);
  if (!created.ok) throw new Error(`the setup is rejected: ${created.error.message}`);
  let state = created.state;
  const events = [...created.events];
  for (const [i, action] of actions.slice(0, upTo).entries()) {
    const result = applyAction(state, action, cards);
    if (!result.ok) throw new Error(`action ${i + 1} is rejected: ${result.error.message}`);
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}

/** Reads a game file, checking its format. */
export function readGameFile(path: string): GameFile {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof raw !== "object" || raw === null || (raw as { format?: unknown }).format !== FORMAT) {
    throw new Error(`${path} isn't a game file`);
  }
  const file = raw as GameFile;
  if (file.version !== ENGINE_VERSION)
    throw new Error(`${path} is from engine version ${file.version}, not ${ENGINE_VERSION}`);
  return file;
}

/** The game's current state: the cache if there is one, otherwise a replay. */
export function currentState(file: GameFile, cards: CardDatabase): GameState {
  return file.state ?? replay(file.setup, file.actions, cards).state;
}

export function writeGameFile(path: string, file: GameFile): void {
  writeFileSync(path, `${JSON.stringify(file)}\n`);
}

/** A new game file for this setup, with the state after creating the game cached. */
export function newGameFile(setup: GameSetup, cards: CardDatabase): GameFile {
  const { state } = replay(setup, [], cards);
  return { format: FORMAT, version: ENGINE_VERSION, setup, actions: [], state };
}

/**
 * A game file as text with one action per line, so a diff shows which actions changed: `head`'s fields first, each on
 * one line, then the actions. Saved replays and golden games are written this way.
 */
export function actionPerLineText(head: Record<string, unknown>, actions: readonly Action[]): string {
  const fields = Object.entries(head).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  const lines = actions.map((a) => `    ${JSON.stringify(a)}`).join(",\n");
  return `{\n${fields.join(",\n")},\n  "actions": [\n${lines}\n  ]\n}\n`;
}
