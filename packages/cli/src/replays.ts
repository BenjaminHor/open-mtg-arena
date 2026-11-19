// The saved replays in packages/engine/test/replays/ (docs/testing.md, section 4): game files that must keep producing
// the same final state. Each stores a hash of that state; `pnpm replays:update` rewrites the hashes after an intended
// engine change (explain why in the commit), and fills in the hash of a game file newly copied there.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cardDatabase } from "@mtg/cards";
import { type CardDatabase, ENGINE_VERSION, type GameState } from "@mtg/engine";
import { actionPerLineText, FORMAT, type GameFile, replay } from "./game-file.ts";

export const REPLAYS_DIR = join(import.meta.dirname, "../../engine/test/replays");

/** A saved replay: a game file without the cached state, what it's for, and the hash of its final state. */
export type ReplayFile = Omit<GameFile, "state"> & { description: string; finalStateHash: string };

/** SHA-256 of the state's JSON, which is deterministic: the engine builds objects in a fixed key order. */
export function stateHash(state: GameState): string {
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

export function replayFiles(dir = REPLAYS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => join(dir, f));
}

export function readReplay(path: string): ReplayFile {
  const raw = JSON.parse(readFileSync(path, "utf8")) as ReplayFile;
  if (raw.format !== FORMAT) throw new Error(`${path} isn't a game file`);
  return raw;
}

/** Why the replay no longer holds, or null when it does. */
export function replayProblem(file: ReplayFile, cards: CardDatabase): string | null {
  if (file.version !== ENGINE_VERSION) return `it's from engine version ${file.version}, not ${ENGINE_VERSION}`;
  let state: GameState;
  try {
    state = replay(file.setup, file.actions, cards).state;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  const hash = stateHash(state);
  return hash === file.finalStateHash ? null : `the final state's hash is ${hash}, not ${file.finalStateHash}`;
}

/**
 * The file as text: one action per line, so a diff shows which actions changed. Its fields in a fixed order; a cached
 * state is dropped (the replay is the record).
 */
export function replayText(file: ReplayFile): string {
  const head = {
    format: file.format,
    version: file.version,
    description: file.description,
    finalStateHash: file.finalStateHash,
    setup: file.setup,
  };
  return actionPerLineText(head, file.actions);
}

/** Rewrites every replay's hash from the current engine. Returns one line per file that changed. */
export function updateReplays(dir: string, cards: CardDatabase): string[] {
  const changed: string[] = [];
  for (const path of replayFiles(dir)) {
    const file = readReplay(path);
    const state = replay(file.setup, file.actions, cards).state;
    const updated: ReplayFile = {
      ...file,
      version: ENGINE_VERSION,
      description: file.description ?? "",
      finalStateHash: stateHash(state),
    };
    const text = replayText(updated);
    if (text !== readFileSync(path, "utf8")) {
      writeFileSync(path, text);
      const hash =
        file.finalStateHash === updated.finalStateHash
          ? "same final state, file rewritten"
          : `final state ${file.finalStateHash ?? "(none)"} → ${updated.finalStateHash}`;
      changed.push(`${path}: ${hash}`);
    }
  }
  return changed;
}

if (import.meta.main) {
  const changed = updateReplays(REPLAYS_DIR, cardDatabase());
  console.log(changed.length === 0 ? "every replay is up to date" : changed.join("\n"));
}
