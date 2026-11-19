// Golden games (docs/testing.md, section 4): each still plays out to the same event log. If one fails, the diff is
// what an engine change did to that game; if the change is intended, run `pnpm golden:update` and explain the diff in
// the commit.

import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cardDatabase, POOL } from "@mtg/cards";
import { applyAction, createGame, type GameState } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import {
  GOLDEN_DIR,
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

    it(`${name} is written the way pnpm golden:update writes it, one action per line`, () => {
      expect(readFileSync(file, "utf8")).toBe(goldenText(readGolden(file)));
    });
  }
});

describe("updateGoldens", () => {
  const copy = (): string => {
    const dir = mkdtempSync(path.join(tmpdir(), "mtg-golden-"));
    const source = path.join(GOLDEN_DIR, "green-stompy-vs-green-stompy-33.json");
    copyFileSync(source, path.join(dir, "g.json"));
    copyFileSync(logPath(source), path.join(dir, "g.log"));
    return path.join(dir, "g.json");
  };

  it("leaves games that still play out the same alone", { timeout: 30_000 }, () => {
    expect(updateGoldens(path.dirname(copy()), cards)).toEqual([]);
  });

  it("rewrites a log that no longer matches, and says so", { timeout: 30_000 }, () => {
    const file = copy();
    writeFileSync(logPath(file), "T1 something else\n");
    expect(updateGoldens(path.dirname(file), cards)).toEqual([`${file}: log changed`]);
    expect(readFileSync(logPath(file), "utf8")).toBe(goldenLog(readGolden(file), cards));
  });

  it("plays a game again from its recipe when its actions no longer play out", { timeout: 30_000 }, () => {
    const file = copy();
    const original = readGolden(file);
    // Stopping part way: the game no longer reaches its end, as after a rules change that made it longer.
    writeFileSync(file, goldenText({ ...original, actions: original.actions.slice(0, 100) }));
    const [line] = updateGoldens(path.dirname(file), cards);
    expect(line).toMatch(/played again from its recipe \(actions differ from action 101: 100 before, \d+ now\)/);
    expect(readGolden(file).actions).toEqual(original.actions);
  });

  it("shows a rejected action at the end of the log, so the diff says where the game went differently", () => {
    const original = readGolden(copy());
    const broken: GoldenGame = {
      ...original,
      actions: [original.actions[0], ...original.actions.slice(2)] as GoldenGame["actions"],
    };
    expect(goldenLog(broken, cards)).toMatch(/\n!! action 2 is rejected: .+\n$/);
  });
});

/** The names of the cards a game plays (lands), casts (spells) or activates (abilities' sources). */
function cardsUsed(game: GoldenGame): string[] {
  const created = createGame(game.setup, cards);
  if (!created.ok) throw new Error(created.error.message);
  let state: GameState = created.state;
  const names: string[] = [];
  const nameOf = (s: GameState, id: string): string => {
    const obj = s.objects[id as keyof typeof s.objects];
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
