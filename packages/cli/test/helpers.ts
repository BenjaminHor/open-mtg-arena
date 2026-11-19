// Running the CLI in tests: in-process, through `run`, on files in a temp dir.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "../src/main.ts";

/** Runs a command and returns its output; throws with the output if it fails. */
export function cli(...args: string[]): string {
  const { output, code } = run(args);
  if (code !== 0) throw new Error(output);
  return output;
}

export const tempFile = (): string => path.join(mkdtempSync(path.join(tmpdir(), "mtg-cli-")), "game.json");

/** A new game file between the prebuilt decks, p1 going first. */
export function deckGame(seed: string): string {
  const file = tempFile();
  cli("new", "--decks", "red-aggro,green-stompy", "--seed", seed, "--first", "p1", "--out", file);
  return file;
}
