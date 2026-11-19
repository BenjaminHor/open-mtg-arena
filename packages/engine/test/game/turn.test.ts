// Turn structure (CR 500–514) and passing priority with an empty stack (CR 117.3d, 117.4, 500.2).
// TypeScript until the M1-16 scenario runner; then these become YAML scenarios.

import { describe, expect, it } from "vitest";
import type { GameEvent, GameState, PermanentSetup, PlayerId, Step } from "../../src/index.ts";
import { applyAction, createGame } from "../../src/index.ts";
import { emptyManaPool } from "../../src/state/mana.ts";
import { TEST_CARDS } from "../support/cards.ts";
import { act, answer, type Game, playerSetup, standardSetup, start } from "../support/game.ts";

const hand = (s: GameState, p: PlayerId) => s.zones.players[p]?.hand ?? [];
const graveyard = (s: GameState, p: PlayerId) => s.zones.players[p]?.graveyard ?? [];
const deck = (card: string, n = 30) => Array.from({ length: n }, () => card);
const permanent = (oracleId: string, fields: Partial<PermanentSetup> = {}): PermanentSetup => ({
  oracleId,
  tapped: false,
  summoningSick: false,
  damage: 0,
  counters: {},
  ...fields,
});

/** The pending player passes priority. */
function pass(game: Game): Game {
  const pending = game.state.pending;
  if (pending?.kind !== "priority") throw new Error(`Expected priority, got ${pending?.kind}`);
  return act(game, { type: "PASS_PRIORITY", decisionId: pending.id, player: pending.player });
}

/** Everyone passes in succession, so the current step ends (CR 117.4). */
function allPass(game: Game): Game {
  let next = game;
  for (const _ of game.state.turnOrder) next = pass(next);
  return next;
}

/** Passes until turn `number` begins, discarding the first card whenever cleanup asks for a discard. */
function playUntilTurn(game: Game, number: number): Game {
  let next = game;
  let actions = 0;
  while ((next.state.turn?.number ?? 0) < number) {
    // A bound, so a bug that stops the turn advancing fails the test instead of hanging the suite.
    if (++actions > 1000) throw new Error(`turn ${number} never began`);
    if (next.state.pending?.kind === "discardToHandSize") {
      const active = next.state.pending.player;
      next = answer(next, { kind: "discardToHandSize", object: hand(next.state, active)[0] as `o${number}` });
    } else {
      next = pass(next);
    }
  }
  return next;
}

function stepsBegun(events: GameEvent[]): string[] {
  return events.flatMap((e) => (e.type === "STEP_BEGAN" ? [`T${e.turn} ${e.step}`] : []));
}

/** A standard game where p1 goes first and both players keep. */
function keptGame(): Game {
  let game = start(standardSetup({ opening: { kind: "standard", firstPlayer: "p1" } }));
  game = answer(game, { kind: "mulligan", choice: "keep" });
  return answer(game, { kind: "mulligan", choice: "keep" });
}

/** A fixed game in the given step of p1's turn 1. */
function fixedGame(
  step: Step,
  p1: Parameters<typeof playerSetup>[1] = {},
  p2: Parameters<typeof playerSetup>[1] = {},
): Game {
  return start({
    seed: 1,
    players: [
      playerSetup("p1", { library: deck("forest"), ...p1 }),
      playerSetup("p2", { library: deck("mountain"), ...p2 }),
    ],
    opening: { kind: "fixed", turn: { number: 1, activePlayer: "p1", step } },
    ruleModifiers: [],
  });
}

describe("walking a turn (CR 500.1)", () => {
  it("goes through every step in order, skipping the starting player's first draw step and the empty combat steps", () => {
    let game = keptGame();
    const priority: string[] = [];
    for (let guard = 0; game.state.turn?.number === 1; guard++) {
      if (guard > 50) throw new Error("turn 1 never ended");
      priority.push(`${game.state.turn.step} ${game.state.pending?.player}`);
      game = allPass(game);
    }
    // Priority in each step, active player first. No priority in untap or cleanup (CR 502.4, 514.3). No draw step on
    // turn 1 (CR 103.8a, 500.11). No declare blockers or combat damage step without attackers (CR 508.8).
    expect(priority).toStrictEqual([
      "upkeep p1",
      "precombatMain p1",
      "beginningOfCombat p1",
      "declareAttackers p1",
      "endOfCombat p1",
      "postcombatMain p1",
      "end p1",
    ]);
    expect(stepsBegun(game.events)).toStrictEqual([
      "T1 untap",
      "T1 upkeep",
      "T1 precombatMain",
      "T1 beginningOfCombat",
      "T1 declareAttackers",
      "T1 endOfCombat",
      "T1 postcombatMain",
      "T1 end",
      "T1 cleanup",
      "T2 untap",
      "T2 upkeep",
    ]);
    expect(game.state.turn).toStrictEqual({ number: 2, activePlayer: "p2", step: "upkeep" });
    expect(game.state.pending).toMatchObject({ player: "p2", kind: "priority" });
  });

  it("gives the second player a draw step on turn 2, and the starting player one on turn 3 (CR 504.1)", () => {
    let game = keptGame();
    expect(hand(game.state, "p1")).toHaveLength(7);
    game = playUntilTurn(game, 2);
    game = allPass(game); // p2's upkeep ends; the draw step begins
    expect(game.state.turn?.step).toBe("draw");
    expect(hand(game.state, "p2")).toHaveLength(8);
    // The step begins, then its turn-based action: the draw (CR 504.1).
    const drawStep = game.events.findLastIndex((e) => e.type === "STEP_BEGAN" && e.step === "draw");
    expect(game.events.slice(drawStep + 1).map((e) => e.type)).toStrictEqual(["ZONE_CHANGED", "CARD_DRAWN"]);
    expect(game.events.at(-1)).toMatchObject({ type: "CARD_DRAWN", player: "p2" });
    game = playUntilTurn(game, 3);
    expect(game.events.filter((e) => e.type === "CARD_DISCARDED" && e.player === "p2")).toHaveLength(1);
    game = allPass(game);
    expect(game.state.turn).toMatchObject({ number: 3, activePlayer: "p1", step: "draw" });
    expect(hand(game.state, "p1")).toHaveLength(8);
  });
});

describe("passing priority (CR 117.3d, 117.4)", () => {
  it("gives the next player priority, and ends the step only when all have passed in succession", () => {
    let game = fixedGame("precombatMain");
    expect(game.state.pending).toMatchObject({ player: "p1", kind: "priority" });
    game = pass(game);
    expect(game.state.turn?.step).toBe("precombatMain");
    expect(game.state.pending).toMatchObject({ player: "p2", kind: "priority" });
    expect(game.events.at(-1)).toStrictEqual({ type: "PRIORITY_PASSED", player: "p1" });
    game = pass(game);
    expect(game.state.turn?.step).toBe("beginningOfCombat");
    // A new step starts the count again: one pass isn't enough to end it.
    expect(game.state.pending).toMatchObject({ player: "p1", kind: "priority" });
    game = pass(game);
    expect(game.state.turn?.step).toBe("beginningOfCombat");
  });

  it("rejects a pass from the player without priority", () => {
    const game = fixedGame("upkeep");
    const pending = game.state.pending;
    if (pending === null) throw new Error("expected priority");
    const result = applyAction(game.state, { type: "PASS_PRIORITY", decisionId: pending.id, player: "p2" }, TEST_CARDS);
    expect(result).toMatchObject({ ok: false, error: { code: "notYourPriority" } });
  });
});

describe("mana empties as each step ends (CR 500.5)", () => {
  it("empties every player's pool, and says what was lost", () => {
    const mana = (R: number, G: number) => ({ ...emptyManaPool(), R, G });
    let game = fixedGame("precombatMain", { manaPool: mana(2, 0) }, { manaPool: mana(0, 1) });
    game = pass(game);
    expect(game.state.players.p1?.manaPool).toStrictEqual(mana(2, 0)); // the step hasn't ended yet
    game = pass(game);
    expect(game.state.players.p1?.manaPool).toStrictEqual(emptyManaPool());
    expect(game.state.players.p2?.manaPool).toStrictEqual(emptyManaPool());
    expect(game.events).toContainEqual({ type: "MANA_EMPTIED", player: "p1", lost: mana(2, 0) });
    expect(game.events).toContainEqual({ type: "MANA_EMPTIED", player: "p2", lost: mana(0, 1) });
    expect(game.events.filter((e) => e.type === "MANA_EMPTIED")).toHaveLength(2); // nothing for empty pools
  });
});

describe("untap step (CR 502.3)", () => {
  it("untaps only the active player's permanents, which are then controlled since the turn began (CR 302.6)", () => {
    let game = fixedGame(
      "end",
      { battlefield: [permanent("forest", { tapped: true })] },
      {
        battlefield: [
          permanent("mountain", { tapped: true }),
          permanent("grizzly-bears", { tapped: true, summoningSick: true }),
          permanent("mountain"), // already untapped: no event for it
        ],
      },
    );
    game = allPass(game); // p1's end step ends; cleanup, then p2's turn 2
    const [p1Forest, p2Mountain, p2Bears] = game.state.zones.battlefield.map((id) => game.state.objects[id]);
    const untapped = game.events.flatMap((e) => (e.type === "PERMANENT_UNTAPPED" ? [e.object] : []));
    expect(untapped).toStrictEqual(game.state.zones.battlefield.slice(1, 3));
    expect(game.state.turn).toMatchObject({ number: 2, activePlayer: "p2" });
    expect(p1Forest).toMatchObject({ tapped: true });
    expect(p2Mountain).toMatchObject({ tapped: false, controlledSinceTurnStart: true });
    expect(p2Bears).toMatchObject({ tapped: false, controlledSinceTurnStart: true });
    expect(game.events.filter((e) => e.type === "PERMANENT_UNTAPPED")).toHaveLength(2);
  });
});

describe("cleanup step (CR 514)", () => {
  it("has only the active player discard down to seven, one card at a time (CR 514.1, 402.2)", () => {
    const nine = deck("forest", 9);
    let game = fixedGame("end", { hand: nine }, { hand: nine });
    game = allPass(game);
    expect(game.state.turn?.step).toBe("cleanup");
    expect(game.state.pending).toMatchObject({ player: "p1", kind: "discardToHandSize", remaining: 2 });
    const [first, second] = hand(game.state, "p1") as [`o${number}`, `o${number}`];
    game = answer(game, { kind: "discardToHandSize", object: first });
    expect(game.state.pending).toMatchObject({
      player: "p1",
      kind: "discardToHandSize",
      remaining: 1,
      chosen: [first],
    });
    // Nothing is discarded until all are chosen, and a chosen card can't be chosen again.
    expect(hand(game.state, "p1")).toHaveLength(9);
    expect(() => answer(game, { kind: "discardToHandSize", object: first })).toThrow(/isn't a legal answer/);
    game = answer(game, { kind: "discardToHandSize", object: second });
    expect(hand(game.state, "p1")).toHaveLength(7);
    expect(graveyard(game.state, "p1")).toHaveLength(2);
    const discards = game.events.filter((e) => e.type === "CARD_DISCARDED");
    expect(discards.map((e) => e.type === "CARD_DISCARDED" && e.player)).toStrictEqual(["p1", "p1"]);
    expect(hand(game.state, "p2")).toHaveLength(9);
    expect(game.events.filter((e) => e.type === "CARD_DISCARDED")).toHaveLength(2);
    expect(game.state.turn).toMatchObject({ number: 2, activePlayer: "p2", step: "upkeep" });
  });

  it("removes damage from every permanent, the active player's and the other's (CR 514.2)", () => {
    const hurt = permanent("grizzly-bears", { damage: 1 });
    let game = fixedGame("end", { battlefield: [hurt] }, { battlefield: [hurt] });
    game = allPass(game);
    for (const id of game.state.zones.battlefield) expect(game.state.objects[id]).toMatchObject({ damage: 0 });
    expect(game.events.filter((e) => e.type === "DAMAGE_REMOVED")).toHaveLength(2);
  });
});

describe("drawing from an empty library (CR 121.4, 704.5b)", () => {
  it("records the attempt instead of failing, and the player loses at the next state-based action check", () => {
    // Before M1-12 this test checked the record stayed set; state-based actions now act on it and clear it.
    let game = fixedGame("end", {}, { library: [] });
    game = allPass(game); // p2's turn 2: untap, upkeep
    game = allPass(game); // draw step: p2 tries to draw, then loses before anyone gets priority
    expect(game.state.turn?.step).toBe("draw");
    expect(game.events.some((e) => e.type === "CARD_DRAWN" && e.player === "p2")).toBe(false);
    expect(game.state.result).toMatchObject({
      winner: "p1",
      losses: [{ player: "p2", reason: "drewFromEmptyLibrary" }],
    });
    expect(game.state.players.p2?.attemptedDrawFromEmptyLibrary).toBe(false);
  });
});

describe("beginning a turn", () => {
  it("lets every player play a land again: the count of lands played this turn starts over (CR 305.2)", () => {
    // Nothing plays lands until M1-09, so start from a state where both players already have.
    const game = fixedGame("end");
    const players = Object.fromEntries(
      Object.entries(game.state.players).map(([id, p]) => [id, { ...p, landsPlayedThisTurn: 1 }]),
    ) as GameState["players"];
    const next = allPass({ state: { ...game.state, players }, events: [] });
    expect(next.state.players.p1?.landsPlayedThisTurn).toBe(0);
    expect(next.state.players.p2?.landsPlayedThisTurn).toBe(0);
  });
});

describe("more turn structure cases (from the M1-06 rules review)", () => {
  it("doesn't draw for the starting player on turn 1 at all (CR 103.8a)", () => {
    let game = keptGame();
    game = allPass(game); // upkeep ends
    expect(game.state.turn).toMatchObject({ number: 1, step: "precombatMain" });
    expect(hand(game.state, "p1")).toHaveLength(7);
    const turnBegan = game.events.findIndex((e) => e.type === "TURN_BEGAN");
    expect(game.events.slice(turnBegan).some((e) => e.type === "CARD_DRAWN")).toBe(false);
  });

  it("rejects a fixed opening in the starting player's skipped first draw step, but not on a later turn", () => {
    const at = (number: number) =>
      createGame(
        { ...standardSetup(), opening: { kind: "fixed", turn: { number, activePlayer: "p1", step: "draw" } } },
        TEST_CARDS,
      );
    expect(at(1)).toMatchObject({
      ok: false,
      error: { code: "invalidSetup", message: expect.stringMatching(/103.8a/) },
    });
    expect(at(2).ok).toBe(true);
  });

  it("discards before damage wears off, and passing isn't allowed while discarding (CR 514.1, 514.2, 514.3)", () => {
    let game = fixedGame("end", { hand: deck("forest", 8), battlefield: [permanent("grizzly-bears", { damage: 1 })] });
    game = allPass(game);
    expect(game.state.pending).toMatchObject({ player: "p1", kind: "discardToHandSize" });
    const bears = game.state.zones.battlefield[0] as `o${number}`;
    expect(game.state.objects[bears]).toMatchObject({ damage: 1 });
    const pending = game.state.pending;
    if (pending === null) throw new Error("expected a decision");
    const passing = applyAction(
      game.state,
      { type: "PASS_PRIORITY", decisionId: pending.id, player: "p1" },
      TEST_CARDS,
    );
    expect(passing).toMatchObject({ ok: false, error: { code: "illegalAction" } });
    game = answer(game, { kind: "discardToHandSize", object: hand(game.state, "p1")[0] as `o${number}` });
    expect(game.state.objects[bears]).toMatchObject({ damage: 0 });
  });

  it("doesn't make the non-active player discard, even over seven (CR 514.1)", () => {
    let game = fixedGame("end", { hand: deck("forest", 1) }, { hand: deck("mountain", 9) });
    game = allPass(game);
    expect(game.state.turn).toMatchObject({ number: 2, activePlayer: "p2", step: "upkeep" });
    expect(hand(game.state, "p2")).toHaveLength(9);
  });

  it("leaves the non-active player's permanents tapped and summoning sick through the other player's untap step", () => {
    let game = fixedGame(
      "end",
      {},
      { battlefield: [permanent("grizzly-bears", { tapped: true, summoningSick: true })] },
    );
    game = allPass(game); // p1's turn ends; p2's turn 2
    game = playUntilTurn(game, 3); // p2's turn ends; p1's turn 3
    const bears = game.state.objects[game.state.zones.battlefield[0] as `o${number}`];
    expect(game.state.turn?.activePlayer).toBe("p1");
    // p2 untapped it on turn 2 and it's been theirs since; on p1's turn it doesn't untap or change again.
    expect(bears).toMatchObject({ tapped: false, controlledSinceTurnStart: true });
    const tappedAgain = fixedGame(
      "end",
      { battlefield: [permanent("forest", { tapped: true, summoningSick: true })] },
      {},
    );
    const afterP1 = allPass(tappedAgain); // p2's untap step
    expect(afterP1.state.objects[afterP1.state.zones.battlefield[0] as `o${number}`]).toMatchObject({
      tapped: true,
      controlledSinceTurnStart: false,
    });
  });
});
