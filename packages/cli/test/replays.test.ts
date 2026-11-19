// The saved replays (docs/testing.md, section 4) still play out to the same final state, and `pnpm replays:update`
// writes hashes and files the way the test reads them.

import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cardDatabase } from "@mtg/cards";
import { describe, expect, it } from "vitest";
import { replay } from "../src/game-file.ts";
import { REPLAYS_DIR, readReplay, replayFiles, replayProblem, updateReplays } from "../src/replays.ts";
import { cli, deckGame } from "./helpers.ts";

const cards = cardDatabase();

describe("the saved replays", () => {
  const files = replayFiles();

  it("exist", () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  for (const file of files) {
    it(`${path.basename(file)} reaches the same final state (if an intended change alters it: pnpm replays:update)`, () => {
      expect(replayProblem(readReplay(file), cards)).toBeNull();
    });
  }
});

describe("replayProblem", () => {
  const original = readReplay(path.join(REPLAYS_DIR, "random-decks-concession.json"));

  it("reports a different final state", () => {
    const broken = { ...original, finalStateHash: "0".repeat(64) };
    expect(replayProblem(broken, cards)).toMatch(/^the final state's hash is [0-9a-f]{64}, not 0{64}$/);
  });

  it("reports an action the engine now rejects", () => {
    const broken = { ...original, actions: original.actions.slice(1) };
    expect(replayProblem(broken, cards)).toMatch(/^action 1 is rejected/);
  });
});

describe("updateReplays", () => {
  it("fills in a new game file's hash and description, drops its cached state, and then leaves it alone", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mtg-replays-"));
    const game = deckGame("8");
    cli("ai", game, "--until", "p1");
    copyFileSync(game, path.join(dir, "new.json"));
    expect(updateReplays(dir, cards)).toHaveLength(1);
    const saved = readReplay(path.join(dir, "new.json"));
    expect(saved).not.toHaveProperty("state");
    expect(saved.description).toBe("");
    expect(replayProblem(saved, cards)).toBeNull();
    expect(updateReplays(dir, cards)).toEqual([]);
  });

  it("writes one action per line, so a diff shows which actions changed", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mtg-replays-"));
    copyFileSync(path.join(REPLAYS_DIR, "random-decks-concession.json"), path.join(dir, "r.json"));
    const file = path.join(dir, "r.json");
    writeFileSync(file, JSON.stringify(readReplay(file)));
    updateReplays(dir, cards);
    const text = readFileSync(file, "utf8");
    const saved = readReplay(file);
    expect(text.split("\n").filter((line) => line.startsWith('    {"type"'))).toHaveLength(saved.actions.length);
    expect(replay(saved.setup, saved.actions, cards).state.result).not.toBeNull();
  });
});
