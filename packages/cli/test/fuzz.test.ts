// The fuzzer (docs/testing.md, section 3): its checks catch what they should, a failure is written as a game file
// that the CLI opens, and the turn cap flags long games.

import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cardDatabase } from "@mtg/cards";
import type { GameEvent, GameState, PlayerId } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { fuzz } from "../src/fuzz.ts";
import { ALL_CHECKS, type Check, lifeThroughEvents, viewsLeakNothing } from "../src/fuzz/checks.ts";
import { fuzzGame } from "../src/fuzz/run-game.ts";
import { runFuzz } from "../src/fuzz/run-fuzz.ts";
import { readGameFile, replay } from "../src/game-file.ts";
import { cli } from "./helpers.ts";

const cards = cardDatabase();
const tempDir = () => mkdtempSync(path.join(tmpdir(), "mtg-fuzz-"));

describe("fuzzGame", () => {
  it("plays prebuilt decks (even seeds) and random decks (odd seeds) to the end with every check", () => {
    for (const seed of [2, 3]) {
      const result = fuzzGame(seed, ALL_CHECKS, cards);
      expect(result, `seed ${seed}`).toMatchObject({ ok: true });
    }
  });

  it("is deterministic: one seed is one game", () => {
    expect(fuzzGame(7, [], cards)).toEqual(fuzzGame(7, [], cards));
  });

  it("stops at the first failing check, with the game up to the failing action", () => {
    // Fails once anything has been cast: the stack isn't empty.
    const stackCheck: Check = (_before, after) => (after.zones.stack.length > 0 ? ["something on the stack"] : []);
    const result = fuzzGame(2, [stackCheck], cards);
    if (result.ok) throw new Error("expected a failure");
    expect(result.problem).toBe("something on the stack");
    expect(result.file.failingAction).not.toBeNull();
    // The file's actions lead to the state just before the failing action; taking it puts something on the stack.
    const before = replay(result.file.setup, result.file.actions, cards).state;
    expect(before.zones.stack).toHaveLength(0);
    const after = replay(result.file.setup, [...result.file.actions, result.file.failingAction!], cards).state;
    expect(after.zones.stack.length).toBeGreaterThan(0);
  });

  it("flags a game that passes the turn cap", () => {
    const result = fuzzGame(2, [], cards, 3);
    expect(result).toMatchObject({ ok: false, problem: "the game passed 3 turns: a likely loop" });
  });
});

describe("runFuzz", () => {
  it("writes each failure as a game file that `pnpm cli replay` opens", () => {
    const outDir = tempDir();
    const failing: Check = (_b, after) => ((after.turn?.number ?? 0) >= 3 ? ["turn 3"] : []);
    const summary = runFuzz({ games: 2, seed: 40, outDir, checks: [failing] }, cards);
    expect(summary.failures.map((f) => f.seed)).toEqual([40, 41]);
    expect(readdirSync(outDir).sort()).toEqual(["seed-40.json", "seed-41.json"]);
    const file = path.join(outDir, "seed-40.json");
    expect(readGameFile(file)).toMatchObject({ problem: "turn 3" });
    // The game just before the failing action, which began turn 3.
    expect(cli("replay", file)).toContain("Turn 2");
  });

  it("writes nothing when every game passes", () => {
    const outDir = path.join(tempDir(), "failures");
    expect(runFuzz({ games: 1, seed: 1, outDir, checks: [] }, cards).failures).toEqual([]);
    expect(() => readdirSync(outDir)).toThrow();
  });
});

describe("pnpm fuzz", () => {
  it("reports the seeds it played and exits 0 when all pass", () => {
    const outDir = tempDir();
    expect(fuzz(["--games", "1", "--seed", "4", "--out", outDir], 0)).toEqual({
      output: "1 games, seeds 4–4: 0 failed",
      code: 0,
    });
  });

  it("exits 1 on a failure, printing the seed and how to rerun it", () => {
    const outDir = tempDir();
    const { output, code } = fuzz(["--games", "1", "--seed", "4", "--turn-cap", "1", "--out", outDir], 0);
    expect(code).toBe(1);
    expect(output).toContain("seed 4: the game passed 1 turns");
    expect(output).toContain("pnpm fuzz --games 1 --seed 4");
  });

  it("refuses bad options", () => {
    expect(fuzz(["--games", "ten"], 0)).toEqual({ output: "--games is a whole number, 0 or more", code: 1 });
    expect(fuzz(["--colour"], 0).code).toBe(1);
  });
});

describe("the checks", () => {
  const state = (): GameState => {
    const { setup, actions } = turnTwoGame();
    return replay(setup, actions, cards).state;
  };

  it("lifeThroughEvents: a life change with no event is a problem", () => {
    const before = state();
    const p1 = before.turnOrder[0]!;
    const after = { ...before, players: { ...before.players, [p1]: { ...before.players[p1]!, life: 17 } } };
    expect(lifeThroughEvents(before, after, [], cards)).toEqual([`${p1}'s life changed by -3, but the events say 0`]);
    expect(lifeThroughEvents(before, after, [{ type: "LIFE_LOST", player: p1, amount: 3 }], cards)).toEqual([]);
  });

  it("viewsLeakNothing: an event naming another player's hidden card is a problem", () => {
    const before = state();
    const [p1, p2] = before.turnOrder as [PlayerId, PlayerId];
    const object = before.zones.players[p2]!.hand[0]!;
    const hidden = before.objects[object]!;
    if (hidden.kind !== "card") throw new Error("a card in hand");
    expect(viewsLeakNothing(before, before, [], cards)).toEqual([]);
    // A made-up event that names p2's card in hand. Events of this type pass through unfiltered, so the check sees it.
    const leak: GameEvent = { type: "SPELL_CAST", player: p2, object, cardId: hidden.cardId };
    expect(viewsLeakNothing(before, before, [leak], cards)).toEqual([
      `the events shown to ${p1} name ${hidden.cardId}, which is hidden from them`,
    ]);
  });
});

/** A game up to the start of turn 2, where both players have cards in hand. */
function turnTwoGame() {
  const result = fuzzGame(2, [], cards, 1);
  if (result.ok) throw new Error("a turn cap of 1 stops the game in turn 2");
  return result.file;
}
