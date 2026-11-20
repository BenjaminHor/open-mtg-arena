// The fuzzer (docs/testing.md, section 3): its checks catch what they should, a failure is written as a game file
// that the CLI opens, and the turn cap flags long games.

import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cardDatabase } from "@mtg/cards";
import {
  type GameEvent,
  type GameState,
  type ObjectId,
  type PlayerId,
  type PlayerState,
  playerView,
} from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { ALL_CHECKS, type Check, lifeThroughEvents, scrambleHidden, viewsLeakNothing } from "../src/fuzz/checks.ts";
import { runFuzz } from "../src/fuzz/run-fuzz.ts";
import { fuzzGame } from "../src/fuzz/run-game.ts";
import { fuzz } from "../src/fuzz.ts";
import { readGameFile, replay } from "../src/game-file.ts";
import { cli } from "./helpers.ts";

const cards = cardDatabase();
const tempDir = () => mkdtempSync(path.join(tmpdir(), "mtg-fuzz-"));

describe("fuzzGame", () => {
  // The short fuzz `pnpm check` runs (docs/testing.md, section 3): fixed seeds, so a failure is the same every time.
  it("plays prebuilt decks (even seeds) and random decks (odd seeds) to the end with every check: seeds 1 to 6", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const result = fuzzGame(seed, ALL_CHECKS, cards);
      expect(result.ok ? "ok" : result.problem, `seed ${seed}`).toBe("ok");
    }
  }, 60_000);

  it("is deterministic: one seed is one game", () => {
    expect(fuzzGame(7, [], cards)).toEqual(fuzzGame(7, [], cards));
  });

  it("stops at the first failing check, with the game up to the failing action", () => {
    // Fails once anything has been cast: the stack isn't empty.
    const stackCheck: Check = (_before, after) => (after.zones.stack.length > 0 ? ["something on the stack"] : []);
    const result = fuzzGame(2, [stackCheck], cards);
    if (result.ok) throw new Error("expected a failure");
    expect(result.problem).toBe("something on the stack");
    const failing = result.file.failingAction;
    if (failing === null) throw new Error("expected the failing action");
    // The file's actions lead to the state just before the failing action; taking it puts something on the stack.
    const before = replay(result.file.setup, result.file.actions, cards).state;
    expect(before.zones.stack).toHaveLength(0);
    const after = replay(result.file.setup, [...result.file.actions, failing], cards).state;
    expect(after.zones.stack.length).toBeGreaterThan(0);
  });

  it("checks the opening state too, before any action", () => {
    const opening: Check = (before, after) => (before === after ? ["the opening"] : []);
    expect(fuzzGame(2, [opening], cards)).toMatchObject({
      ok: false,
      problem: "the opening",
      file: { actions: [], failingAction: null },
    });
  });

  it("reports a check that throws as a failure of that game, not a crash", () => {
    const throwing: Check = (_b, after) => {
      if ((after.turn?.number ?? 0) >= 2) throw new Error("boom");
      return [];
    };
    const result = fuzzGame(2, [throwing], cards);
    expect(result).toMatchObject({ ok: false, problem: "a check threw: boom" });
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
  it("reports the seeds it played and exits 0 when all pass", { timeout: 20_000 }, () => {
    const outDir = tempDir();
    expect(fuzz(["--games", "1", "--seed", "4", "--out", outDir], 0)).toEqual({
      output: "1 games, seeds 4–4: 0 failed",
      code: 0,
    });
  });

  it("exits 1 on a failure, printing the seed and how to rerun it", { timeout: 20_000 }, () => {
    const outDir = tempDir();
    const { output, code } = fuzz(["--games", "1", "--seed", "4", "--turn-cap", "1", "--out", outDir], 0);
    expect(code).toBe(1);
    expect(output).toContain("seed 4: the game passed 1 turns");
    expect(output).toContain("pnpm fuzz --games 1 --seed 4");
  });

  it("refuses bad options", () => {
    expect(fuzz(["--games", "ten"], 0)).toEqual({ output: "--games is a whole number, 0 or more", code: 1 });
    expect(fuzz(["--games", "0"], 0)).toEqual({ output: "--games is 1 or more", code: 1 });
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
    const p1 = before.turnOrder[0] as PlayerId;
    const after = {
      ...before,
      players: { ...before.players, [p1]: { ...(before.players[p1] as PlayerState), life: 17 } },
    };
    expect(lifeThroughEvents(before, after, [], cards)).toEqual([`${p1}'s life changed by -3, but the events say 0`]);
    expect(lifeThroughEvents(before, after, [{ type: "LIFE_LOST", player: p1, amount: 3 }], cards)).toEqual([]);
  });

  it("viewsLeakNothing: an event naming another player's hidden card, by card id or object id, is a problem", () => {
    const before = state();
    const [p1, p2] = before.turnOrder as [PlayerId, PlayerId];
    const object = before.zones.players[p2]?.hand[0] as ObjectId;
    const hidden = before.objects[object];
    if (hidden?.kind !== "card") throw new Error("a card in hand");
    expect(viewsLeakNothing(before, before, [], cards)).toEqual([]);
    // A made-up event that names p2's card in hand. Events of this type pass through unfiltered, so the check sees it.
    const leak: GameEvent = { type: "SPELL_CAST", player: p2, object, cardId: hidden.cardId };
    expect(viewsLeakNothing(before, before, [leak], cards)).toEqual([
      `the events shown to ${p1} name ${object}, which is hidden from them`,
      `the events shown to ${p1} name ${hidden.cardId}, which is hidden from them`,
    ]);
  });

  it("viewsLeakNothing: an event naming the card another player is casting, as it was in hand, is a problem", () => {
    // Mid-cast, the card as it was in hand is kept aside in `casting.origin`, in no zone.
    const s = state();
    const [p1, p2] = s.turnOrder as [PlayerId, PlayerId];
    const object = s.zones.players[p2]?.hand[0] as ObjectId;
    const card = s.objects[object];
    if (card?.kind !== "card") throw new Error("a card in hand");
    const p2Zones = s.zones.players[p2];
    if (p2Zones === undefined) throw new Error("p2's zones");
    const casting: GameState = {
      ...s,
      // Out of the hand, as while it's being cast: only `casting.origin` still has it.
      zones: { ...s.zones, players: { ...s.zones.players, [p2]: { ...p2Zones, hand: p2Zones.hand.slice(1) } } },
      casting: {
        player: p2,
        object: "o9999",
        origin: { kind: "card", card, handIndex: 0 },
        poolBefore: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        targetCounts: [],
        tappedForMana: [],
      },
    };
    const leak: GameEvent = { type: "SPELL_CAST", player: p2, object: "o9999", cardId: card.cardId };
    expect(viewsLeakNothing(casting, casting, [leak], cards)).toContain(
      `the events shown to ${p1} name ${card.cardId}, which is hidden from them`,
    );
  });

  it("scrambleHidden changes what a player can't see, and nothing they can", () => {
    const s = state();
    const [p1, p2] = s.turnOrder as [PlayerId, PlayerId];
    const scrambled = scrambleHidden(s, p1);
    // p2's hand is hidden from p1, so it's scrambled, and p2's own view sees that; p1's view doesn't change.
    expect(playerView(scrambled, p2)).not.toEqual(playerView(s, p2));
    expect(playerView(scrambled, p1)).toEqual(playerView(s, p1));
  });
});

/** A game up to the start of turn 2, where both players have cards in hand. */
function turnTwoGame() {
  const result = fuzzGame(2, [], cards, 1);
  if (result.ok) throw new Error("a turn cap of 1 stops the game in turn 2");
  return result.file;
}
