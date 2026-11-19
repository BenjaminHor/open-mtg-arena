// State-based actions (CR 704) the scenarios can't reach in the M1 pool: a second cleanup step (CR 514.3a), a creature
// with 0 toughness and damage, a player losing for two reasons at once. States are built by hand where no card can
// make them.

import { describe, expect, it } from "vitest";
import { applyAction, type CardObject, type GameState, legalActions, type ObjectId } from "../../src/index.ts";
import { stateBasedActions } from "../../src/rules/state-based-actions.ts";
import { HILL_GIANT, TEST_CARDS } from "../support/cards.ts";
import { type Game, passBoth, playerSetup, start } from "../support/game.ts";

const permanent = (oracleId: string) => ({ oracleId, tapped: false, summoningSick: false, damage: 0, counters: {} });

function game(step: "end" | "precombatMain", battlefield: string[] = []): Game {
  return start({
    seed: 1,
    players: [
      playerSetup("p1", { library: ["forest", "forest"], battlefield: battlefield.map(permanent) }),
      playerSetup("p2", { library: ["forest", "forest"] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step } },
    ruleModifiers: [],
  });
}

function edit(state: GameState, id: ObjectId, fields: Partial<CardObject>): GameState {
  return { ...state, objects: { ...state.objects, [id]: { ...(state.objects[id] as CardObject), ...fields } } };
}

describe("which state-based actions apply (CR 704.5)", () => {
  it("puts a 0-toughness creature with damage into the graveyard, without destroying it (CR 704.5f, 704.5g)", () => {
    const g = game("precombatMain", [HILL_GIANT]);
    const giant = g.state.zones.battlefield[0] as ObjectId;
    const state = edit(g.state, giant, { counters: { "-1/-1": 3 }, damage: 2 });
    expect(stateBasedActions(state, TEST_CARDS)).toStrictEqual([{ kind: "zeroToughness", object: giant }]);
  });

  it("makes a player lose once, though two reasons apply (CR 704.5a, 704.5b)", () => {
    const g = game("precombatMain");
    const p2 = g.state.players.p2;
    if (p2 === undefined) throw new Error("no p2");
    const state: GameState = {
      ...g.state,
      players: { ...g.state.players, p2: { ...p2, life: 0, attemptedDrawFromEmptyLibrary: true } },
    };
    // Any action makes the engine check again: p1 passes, and p2 would get priority.
    const pending = state.pending;
    if (pending === null) throw new Error("nothing pending");
    const result = applyAction(state, { type: "PASS_PRIORITY", decisionId: pending.id, player: "p1" }, TEST_CARDS);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.state.result).toStrictEqual({
      winner: "p1",
      losses: [{ player: "p2", reason: "zeroLife" }],
      turn: 3,
    });
    expect(result.events.filter((e) => e.type === "PLAYER_LOST")).toHaveLength(1);
    expect(result.state.work).toStrictEqual([]);
    expect(legalActions(result.state, "p1", TEST_CARDS)).toStrictEqual([]);
  });
});

describe("state-based actions in the cleanup step (CR 514.3a)", () => {
  it("gives the active player priority when any happen, then another cleanup step begins", () => {
    // A Hill Giant with three -1/-1 counters, kept alive by a +3/+3 until end of turn. In cleanup the effect ends
    // (CR 514.2) and the check that follows finds it at 0 toughness.
    const g = game("end", [HILL_GIANT]);
    const giant = g.state.zones.battlefield[0] as ObjectId;
    const pumped: GameState = {
      ...edit(g.state, giant, { counters: { "-1/-1": 3 } }),
      effects: [
        {
          source: giant,
          controller: "p1",
          timestamp: g.state.nextTimestamp,
          duration: "endOfTurn",
          affected: [giant],
          change: { kind: "modifyPT", power: 3, toughness: 3 },
        },
      ],
      nextTimestamp: g.state.nextTimestamp + 1,
    };
    const inCleanup = passBoth({ state: pumped, events: [] });
    expect(inCleanup.state.turn).toMatchObject({ number: 3, step: "cleanup" });
    expect(inCleanup.state.pending).toMatchObject({ player: "p1", kind: "priority" });
    expect(inCleanup.state.zones.players.p1?.graveyard).toHaveLength(1);
    expect(inCleanup.events.some((e) => e.type === "PERMANENT_DESTROYED")).toBe(false);

    const after = passBoth(inCleanup);
    const cleanups = after.events.filter((e) => e.type === "STEP_BEGAN" && e.step === "cleanup");
    expect(cleanups).toHaveLength(2);
    expect(after.state.turn).toMatchObject({ number: 4, activePlayer: "p2" });
  });

  it("ends the step with no one getting priority when none happen (CR 514.3)", () => {
    const g = game("end", [HILL_GIANT]);
    const after = passBoth(g);
    expect(after.events.filter((e) => e.type === "STEP_BEGAN" && e.step === "cleanup")).toHaveLength(1);
    expect(after.state.turn).toMatchObject({ number: 4, activePlayer: "p2" });
  });
});
