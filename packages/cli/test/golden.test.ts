// Golden games (docs/testing.md, section 4): each still plays out to the same event log. If one fails, the diff is
// what an engine change did to that game; if the change is intended, run `pnpm golden:update` and explain the diff in
// the commit.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cardDatabase, DECKS, type DeckList } from "@mtg/cards";
import { type Action, ENGINE_VERSION } from "@mtg/engine";
import { afterEach, describe, expect, it } from "vitest";
import {
  addGolden,
  GOLDEN_DIR,
  type GoldenGame,
  goldenFiles,
  goldenLog,
  goldenText,
  logPath,
  readGolden,
  updateGoldens,
} from "../src/golden.ts";
import { coveredByGoldens, FEATURES } from "../src/golden-cover.ts";
import { wantedMechanics } from "../src/mechanics.ts";

const cards = cardDatabase();

describe("the golden games", () => {
  const files = goldenFiles();

  it("exist, and between them run every mechanic in the pool, answer every kind of decision and show the export tests' choices", {
    timeout: 60_000,
  }, () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
    // A mechanic runs when a card's spell or ability with it resolves (pnpm golden:cover adds games until this holds,
    // D-082); each card is covered by its own scenarios.
    const covered = new Set(coveredByGoldens(GOLDEN_DIR, cards));
    const wanted = [...wantedMechanics(cards), ...Object.values(FEATURES)];
    expect(wanted.filter((unit) => !covered.has(unit))).toEqual([]);
  });

  for (const file of files) {
    const name = path.basename(file, ".json");
    it(`${name} plays out to the same log (if an intended change alters it: pnpm golden:update)`, {
      timeout: 30_000,
    }, () => {
      expect(goldenLog(readGolden(file, cards), cards)).toBe(readFileSync(logPath(file), "utf8"));
    });

    it(`${name} is written the way pnpm golden:update writes it, for this engine version`, () => {
      const game = readGolden(file, cards);
      expect(game.version, "run pnpm golden:update after a version change").toBe(ENGINE_VERSION);
      expect(readFileSync(file, "utf8")).toBe(goldenText(game, cards));
    });
  }
});

describe("goldenLog", () => {
  it("ends with a rejected action, so the diff says where the game went differently", () => {
    const game = smallGame();
    const broken: GoldenGame = { ...game, actions: [game.actions[0], ...game.actions.slice(2)] as Action[] };
    expect(goldenLog(broken, cards)).toMatch(/\n!! action 2 is rejected: .+\n$/);
  });
});

describe("updateGoldens", () => {
  it("leaves a game that still plays out the same alone, including one stopped by its turn cap", () => {
    expect(updateGoldens(path.dirname(smallGameFile()), cards)).toEqual([]);
  });

  it("rewrites a log that no longer matches, and says so", () => {
    const file = smallGameFile();
    writeFileSync(logPath(file), "T1 something else\n");
    expect(updateGoldens(path.dirname(file), cards)).toEqual([`${file}: log changed`]);
    expect(readFileSync(logPath(file), "utf8")).toBe(goldenLog(readGolden(file, cards), cards));
  });

  it("plays a game again from its recipe when an action is rejected, and says why", () => {
    const file = smallGameFile();
    const original = readGolden(file, cards);
    writeFileSync(
      file,
      goldenText({ ...original, actions: [original.actions[0], ...original.actions.slice(2)] as Action[] }, cards),
    );
    const [line] = updateGoldens(path.dirname(file), cards);
    // Stored as lines (D-082), each action answers whatever is pending as it's read back, so dropping one action makes
    // a later one the first rejected: which one depends on the game.
    expect(line).toMatch(/played again from its recipe \(action \d+ is rejected: .+; actions differ from action 2: /);
    expect(readGolden(file, cards).actions).toEqual(original.actions);
    expect(readFileSync(logPath(file), "utf8")).not.toContain("!!");
  });

  it("says when stored action lines are left after the game ended, and plays it again from its recipe", () => {
    const file = smallGameFile();
    const original = readGolden(file, cards);
    // A concession ends the game, so the line after it no longer fits: it's counted, not dropped in silence.
    const text = goldenText(original, cards).replace(
      /\n {2}\]\n\}\n$/,
      ',\n    "p1 concede",\n    "pass p1"\n  ]\n}\n',
    );
    writeFileSync(file, text);
    const [line] = updateGoldens(path.dirname(file), cards);
    expect(line).toMatch(/played again from its recipe \(the game now ends 1 stored action lines sooner; /);
    expect(readGolden(file, cards).actions).toEqual(original.actions);
  });

  it("plays a game again from its recipe when it no longer ends where it did", () => {
    const file = smallGameFile();
    const original = readGolden(file, cards);
    writeFileSync(file, goldenText({ ...original, actions: original.actions.slice(0, 10) }, cards));
    const [line] = updateGoldens(path.dirname(file), cards);
    expect(line).toMatch(
      /played again from its recipe \(the game no longer ends where it did; actions differ from action 11: 10 before, \d+ now\)/,
    );
    expect(readGolden(file, cards).actions).toEqual(original.actions);
  });

  it("keeps actions that still play out, but says when the recipe no longer gives them", () => {
    const file = smallGameFile();
    const original = readGolden(file, cards);
    // A recipe that plays differently now, as after an engine change that reorders the legal actions.
    writeFileSync(file, goldenText({ ...original, agentSeed: original.agentSeed + 1 }, cards));
    const [line] = updateGoldens(path.dirname(file), cards);
    expect(line).toMatch(/actions kept; the recipe now plays differently \(actions differ from action \d+/);
    expect(readGolden(file, cards).actions).toEqual(original.actions);
  });
});

describe("addGolden", () => {
  it("refuses to overwrite a game: pnpm golden:update regenerates", () => {
    const file = smallGameFile();
    expect(() => addSmallGame(path.dirname(file))).toThrow(/exists; pnpm golden:update regenerates it/);
  });
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A golden game of four turns in a new temp folder: quick, and consistent with its recipe by construction. */
function smallGameFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mtg-golden-"));
  dirs.push(dir);
  return addSmallGame(dir);
}

function addSmallGame(dir: string): string {
  const decks = [DECKS["red-aggro"], DECKS["green-stompy"]] as DeckList[];
  const game = {
    decks,
    seed: 5,
    agent: "random",
    agentSeed: 5,
    maxTurns: 4,
    name: "small",
    description: "four turns",
  } as const;
  return addGolden(game, dir, cards);
}

function smallGame(): GoldenGame {
  return readGolden(smallGameFile(), cards);
}
