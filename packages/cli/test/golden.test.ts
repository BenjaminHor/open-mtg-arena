// Golden games (docs/testing.md, section 4): each still plays out to the same event log. If one fails, the diff is
// what an engine change did to that game; if the change is intended, run `pnpm golden:update` and explain the diff in
// the commit.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cardDatabase, DECKS, type DeckList, POOL } from "@mtg/cards";
import { type Action, applyAction, createGame, ENGINE_VERSION, type GameState, type ObjectId } from "@mtg/engine";
import { afterEach, describe, expect, it } from "vitest";
import {
  addGolden,
  type GoldenGame,
  goldenFiles,
  goldenLog,
  goldenText,
  logPath,
  readGolden,
  updateGoldens,
} from "../src/golden.ts";

const cards = cardDatabase();

describe("the golden games", () => {
  const files = goldenFiles();

  it("exist, and between them every card in the pool is played, cast or activated", { timeout: 60_000 }, () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
    const used = new Set(files.flatMap((f) => cardsUsed(readGolden(f))));
    const missing = POOL.cards.map((c) => c.name).filter((name) => !used.has(name));
    expect(missing).toEqual([]);
  });

  for (const file of files) {
    const name = path.basename(file, ".json");
    it(`${name} plays out to the same log (if an intended change alters it: pnpm golden:update)`, {
      timeout: 30_000,
    }, () => {
      expect(goldenLog(readGolden(file), cards)).toBe(readFileSync(logPath(file), "utf8"));
    });

    it(`${name} is written the way pnpm golden:update writes it, for this engine version`, () => {
      const game = readGolden(file);
      expect(game.version, "run pnpm golden:update after a version change").toBe(ENGINE_VERSION);
      expect(readFileSync(file, "utf8")).toBe(goldenText(game));
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
    expect(readFileSync(logPath(file), "utf8")).toBe(goldenLog(readGolden(file), cards));
  });

  it("plays a game again from its recipe when an action is rejected, and says why", () => {
    const file = smallGameFile();
    const original = readGolden(file);
    writeFileSync(
      file,
      goldenText({ ...original, actions: [original.actions[0], ...original.actions.slice(2)] as Action[] }),
    );
    const [line] = updateGoldens(path.dirname(file), cards);
    expect(line).toMatch(/played again from its recipe \(action 2 is rejected: .+; actions differ from action 2: /);
    expect(readGolden(file).actions).toEqual(original.actions);
    expect(readFileSync(logPath(file), "utf8")).not.toContain("!!");
  });

  it("plays a game again from its recipe when it no longer ends where it did", () => {
    const file = smallGameFile();
    const original = readGolden(file);
    writeFileSync(file, goldenText({ ...original, actions: original.actions.slice(0, 10) }));
    const [line] = updateGoldens(path.dirname(file), cards);
    expect(line).toMatch(
      /played again from its recipe \(the game no longer ends where it did; actions differ from action 11: 10 before, \d+ now\)/,
    );
    expect(readGolden(file).actions).toEqual(original.actions);
  });

  it("keeps actions that still play out, but says when the recipe no longer gives them", () => {
    const file = smallGameFile();
    const original = readGolden(file);
    // A recipe that plays differently now, as after an engine change that reorders the legal actions.
    writeFileSync(file, goldenText({ ...original, agentSeed: original.agentSeed + 1 }));
    const [line] = updateGoldens(path.dirname(file), cards);
    expect(line).toMatch(/actions kept; the recipe now plays differently \(actions differ from action \d+/);
    expect(readGolden(file).actions).toEqual(original.actions);
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
  return addGolden({ decks, seed: 5, agentSeed: 5, maxTurns: 4, name: "small", description: "four turns" }, dir, cards);
}

function smallGame(): GoldenGame {
  return readGolden(smallGameFile());
}

/** The names of the cards a game plays (lands), casts (spells) or activates (abilities' sources). */
function cardsUsed(game: GoldenGame): string[] {
  const created = createGame(game.setup, cards);
  if (!created.ok) throw new Error(created.error.message);
  let state: GameState = created.state;
  const names: string[] = [];
  const nameOf = (s: GameState, id: ObjectId): string => {
    const obj = s.objects[id];
    return obj?.kind === "card" ? (cards[obj.oracleId]?.printed.name ?? obj.oracleId) : "";
  };
  for (const action of game.actions) {
    const result = applyAction(state, action, cards);
    if (!result.ok) throw new Error(result.error.message);
    for (const e of result.events) {
      if (e.type === "LAND_PLAYED") names.push(nameOf(result.state, e.newId));
      if (e.type === "SPELL_CAST") names.push(nameOf(result.state, e.object));
      if (e.type === "ABILITY_ACTIVATED") names.push(nameOf(result.state, e.source));
    }
    state = result.state;
  }
  return names;
}
