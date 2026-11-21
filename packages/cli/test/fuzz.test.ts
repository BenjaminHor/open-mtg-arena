// The fuzzer (docs/testing.md, section 3): its checks catch what they should, a failure is written as a game file
// that the CLI opens, and the turn cap flags long games.

import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cardDatabase } from "@mtg/cards";
import {
  type Action,
  type GameEvent,
  type GameState,
  type ObjectId,
  type PlayerId,
  type PlayerState,
  playerView,
} from "@mtg/engine";
import { describe, expect, it } from "vitest";
import {
  ALL_CHECKS,
  type Check,
  controlChangesRecorded,
  layersMatchFreshPass,
  lifeThroughEvents,
  scrambleHidden,
  viewsLeakNothing,
} from "../src/fuzz/checks.ts";
import { runFuzz } from "../src/fuzz/run-fuzz.ts";
import { fuzzGame } from "../src/fuzz/run-game.ts";
import { fuzz } from "../src/fuzz.ts";
import { readGameFile, replay } from "../src/game-file.ts";
import { pickAction } from "../src/pick-action.ts";
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
  it("reports the seeds it played and exits 0 when all pass", { timeout: 20_000 }, async () => {
    const outDir = tempDir();
    expect(await fuzz(["--games", "1", "--seed", "4", "--out", outDir], 0)).toEqual({
      output: "1 games, seeds 4–4: 0 failed",
      code: 0,
    });
  });

  it("exits 1 on a failure, printing the seed and how to rerun it", { timeout: 20_000 }, async () => {
    const outDir = tempDir();
    const { output, code } = await fuzz(["--games", "1", "--seed", "4", "--turn-cap", "1", "--out", outDir], 0);
    expect(code).toBe(1);
    expect(output).toContain("seed 4: the game passed 1 turns");
    expect(output).toContain("pnpm fuzz --games 1 --seed 4");
  });

  it("refuses bad options", async () => {
    expect(await fuzz(["--games", "ten"], 0)).toEqual({ output: "--games is a whole number, 0 or more", code: 1 });
    expect(await fuzz(["--games", "0"], 0)).toEqual({ output: "--games is 1 or more", code: 1 });
    expect((await fuzz(["--games", "2", "--jobs", "0"], 0)).output).toMatch(/^--jobs is 1 or more/);
    expect((await fuzz(["--colour"], 0)).code).toBe(1);
  });
});

describe("pnpm fuzz --jobs (D-117)", () => {
  it("plays the same games on worker threads, writing failures in seed order", { timeout: 60_000 }, async () => {
    const outDir = tempDir();
    const { output, code } = await fuzz(
      ["--games", "3", "--seed", "4", "--turn-cap", "1", "--jobs", "2", "--out", outDir],
      0,
    );
    expect(code).toBe(1);
    expect(output.split("\n")[0]).toBe("3 games, seeds 4–6: 3 failed");
    expect([...output.matchAll(/seed (\d+): /g)].map((m) => m[1])).toEqual(["4", "5", "6"]);
    expect(readdirSync(outDir).sort()).toEqual(["seed-4.json", "seed-5.json", "seed-6.json"]);
    // The same failure file as one thread writes.
    const alone = tempDir();
    await fuzz(["--games", "1", "--seed", "5", "--turn-cap", "1", "--out", alone], 0);
    expect(readGameFile(path.join(outDir, "seed-5.json"))).toEqual(readGameFile(path.join(alone, "seed-5.json")));
  });
});

describe("pickAction (D-061)", () => {
  /** How often each listed action is picked over 4,000 seeded picks. */
  function picks(listed: readonly Action[]): Map<Action, number> {
    const picked = new Map<Action, number>();
    let seed = 1;
    for (let i = 0; i < 4000; i++) {
      const r = pickAction(listed, seed);
      picked.set(r.action, (picked.get(r.action) ?? 0) + 1);
      seed = r.seed;
    }
    return picked;
  }
  const pay = (G: number): Action => ({
    type: "ANSWER",
    decisionId: "d1",
    player: "p1",
    answer: { kind: "payMana", payment: { W: 0, U: 0, B: 0, R: 0, G, C: 0 } },
  });
  const tap = (object: `o${number}`): Action => ({
    type: "ACTIVATE_ABILITY",
    decisionId: "d1",
    player: "p1",
    object,
    ability: { kind: "printed", index: 0 },
  });
  const cancel: Action = { type: "ANSWER", decisionId: "d1", player: "p1", answer: { kind: "cancelCast" } };

  it("picks a kind, then one of that kind: every listed action stays possible, cancel a tenth as often", () => {
    // Paying for a spell: two payments the pool covers, two lands still to tap, and cancel.
    const payments = [pay(1), pay(2)];
    const listed = [...payments, tap("o1"), tap("o2"), cancel];
    const picked = picks(listed);
    for (const a of listed) expect(picked.get(a) ?? 0, JSON.stringify(a)).toBeGreaterThan(0);
    // Weights 1, 1 and 0.1: cancel expected about 190 of 4,000 (uniform among actions would be 800, 0.2 about 364).
    expect(picked.get(cancel)).toBeLessThan(300);
    expect(payments.reduce((n, a) => n + (picked.get(a) ?? 0), 0)).toBeGreaterThan(1700);
  });

  it("picks the only action there is, and the same one for the same seed", () => {
    expect(picks([cancel]).get(cancel)).toBe(4000);
    const listed = [pay(1), tap("o1"), cancel];
    expect(pickAction(listed, 7)).toStrictEqual(pickAction(listed, 7));
    expect(() => pickAction([], 1)).toThrow(/no legal actions/);
  });
});

describe("the checks", () => {
  const state = (): GameState => {
    const { setup, actions } = turnTwoGame();
    return replay(setup, actions, cards).state;
  };

  it("layersMatchFreshPass: a state changed in place after its pass was kept is a problem (D-092)", () => {
    const after = state();
    expect(layersMatchFreshPass(after, after, [], cards)).toEqual([]);
    const [id] = after.zones.battlefield.filter((i) => after.objects[i]?.kind === "card");
    const obj = id === undefined ? undefined : after.objects[id];
    if (id === undefined || obj?.kind !== "card") throw new Error("no card on the battlefield");
    // Never done by the engine: changing the state in place, which the kept pass can't see.
    const other = after.turnOrder.find((p) => p !== obj.baseController) as PlayerId;
    (obj as { baseController: PlayerId }).baseController = other;
    expect(layersMatchFreshPass(after, after, [], cards)).toContain(
      `${id}'s characteristics kept for this state differ from fresh ones (D-092)`,
    );
  });

  it("controlChangesRecorded: a permanent that changed controller must be summoning sick again", () => {
    const before = state();
    const id = before.zones.battlefield[0];
    const obj = id === undefined ? undefined : before.objects[id];
    if (id === undefined || obj?.kind !== "card") throw new Error("the test state needs a permanent");
    const owner = before.turnOrder.find((p) => p !== obj.baseController) as PlayerId;
    const effect = {
      source: id,
      controller: owner,
      timestamp: 9999,
      duration: "endOfTurn" as const,
      affected: [id],
      change: { kind: "gainControl" as const, player: owner },
    };
    const taken = { ...before, effects: [...before.effects, effect] };
    const settled = { ...taken, objects: { ...taken.objects, [id]: { ...obj, controlledSinceTurnStart: true } } };
    expect(controlChangesRecorded(before, settled, [], cards)).toEqual([
      `${id} changed controller but isn't summoning sick again (CR 302.6)`,
    ]);
    const sick = { ...taken, objects: { ...taken.objects, [id]: { ...obj, controlledSinceTurnStart: false } } };
    expect(controlChangesRecorded(before, sick, [], cards)).toEqual([]);
    // Its new controller's turn beginning in the same action makes it controlled since then; the other player's doesn't.
    const began = (activePlayer: PlayerId) => [{ type: "TURN_BEGAN", turn: 9, activePlayer, extra: false }] as const;
    expect(controlChangesRecorded(before, settled, [...began(owner)], cards)).toEqual([]);
    expect(controlChangesRecorded(before, settled, [...began(obj.baseController)], cards)).toHaveLength(1);
    // Still in combat is a problem (CR 506.4); recorded as removed isn't.
    const attacks = [{ attacker: id, defender: obj.baseController }];
    const fighting = {
      ...sick,
      combat: {
        attacks,
        blocks: [],
        removed: { attackers: [], blockers: [] },
        firstStrikers: null,
        secondDamageStep: false,
      },
    };
    expect(controlChangesRecorded(before, fighting, [], cards)).toEqual([
      `${id} changed controller but is still in combat (CR 506.4)`,
    ]);
    const removed = { ...fighting, combat: { ...fighting.combat, removed: { attackers: [id], blockers: [] } } };
    expect(controlChangesRecorded(before, removed, [], cards)).toEqual([]);
  });

  it("lifeThroughEvents: a life change with no event is a problem", () => {
    const before = state();
    const p1 = before.turnOrder[0] as PlayerId;
    const after = {
      ...before,
      players: { ...before.players, [p1]: { ...(before.players[p1] as PlayerState), life: 17 } },
    };
    expect(lifeThroughEvents(before, after, [], cards)).toEqual([`${p1}'s life changed by -3, but the events say 0`]);
    expect(lifeThroughEvents(before, after, [{ type: "LIFE_LOST", player: p1, amount: 3 }], cards)).toEqual([]);
    // Life gained counts too.
    const gained = {
      ...before,
      players: { ...before.players, [p1]: { ...(before.players[p1] as PlayerState), life: 24 } },
    };
    expect(lifeThroughEvents(before, gained, [{ type: "LIFE_GAINED", player: p1, amount: 4 }], cards)).toEqual([]);
    expect(lifeThroughEvents(before, gained, [], cards)).toEqual([`${p1}'s life changed by 4, but the events say 0`]);
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

  it("viewsLeakNothing: a card drawn and discarded in one action (Burning Inquiry) is the drawer's to see", () => {
    // p1 draws the top card of their library, then discards it: it's hidden before and gone after, with a new card id
    // in the graveyard (D-054), but p1 saw it in their hand in between. p2 sees neither the draw nor the old ids.
    const s = state();
    const [p1, p2] = s.turnOrder as [PlayerId, PlayerId];
    const top = s.zones.players[p1]?.library[0] as ObjectId;
    const card = s.objects[top];
    if (card?.kind !== "card") throw new Error("a card in the library");
    const inHand = { ...card, id: "o9001" as ObjectId };
    const events: GameEvent[] = [
      {
        type: "ZONE_CHANGED",
        from: { zone: "library", player: p1 },
        to: { zone: "hand", player: p1 },
        oldId: top,
        newId: inHand.id,
        cardId: card.cardId,
        newCardId: card.cardId,
        object: card,
      },
      { type: "CARD_DRAWN", player: p1, newId: inHand.id, cardId: card.cardId },
      {
        type: "ZONE_CHANGED",
        from: { zone: "hand", player: p1 },
        to: { zone: "graveyard", player: p1 },
        oldId: inHand.id,
        newId: "o9002",
        cardId: card.cardId,
        newCardId: "c9002",
        object: inHand,
      },
      { type: "CARD_DISCARDED", player: p1, newId: "o9002", cardId: "c9002" },
    ];
    expect(viewsLeakNothing(s, s, events, cards)).toEqual([]);
    // Shown to p2 unfiltered, the draw would name the card.
    const unfiltered = viewsLeakNothing(s, s, [{ ...events[1], player: p2 } as GameEvent], cards);
    expect(unfiltered).toContain(`the events shown to ${p2} name ${card.cardId}, which is hidden from them`);
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
        sacrifices: [],
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
