// State-based actions (CR 704) the scenarios can't reach in the M1 pool: a second cleanup step (CR 514.3a), a creature
// with 0 toughness and damage, a player losing for two reasons at once. States are built by hand where no card can
// make them.

import { describe, expect, it } from "vitest";
import { checkStateBasedActions } from "../../src/game/state-based-actions.ts";
import {
  type Action,
  applyAction,
  type CardObject,
  type GameState,
  legalActions,
  type ObjectId,
} from "../../src/index.ts";
import { stateBasedActions } from "../../src/rules/state-based-actions.ts";
import { BEARS, HILL_GIANT, SHOT_AND_BOOST, TEST_ANGEL, TEST_CARDS } from "../support/cards.ts";
import { type Game, passBoth, playerSetup, start, take } from "../support/game.ts";

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

describe("state-based actions are performed together (CR 704.3)", () => {
  it("performs a lethal-damage and a 0-toughness action in one event", () => {
    const g = start({
      seed: 1,
      players: [
        playerSetup("p1", {
          library: ["forest"],
          battlefield: [
            { ...permanent(BEARS), damage: 2 },
            { ...permanent(HILL_GIANT), counters: { "-1/-1": 3 } },
          ],
        }),
        playerSetup("p2", { library: ["forest"] }),
      ],
      opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
      ruleModifiers: [],
    });
    const checks = g.events.filter((e) => e.type === "STATE_BASED_ACTIONS");
    expect(checks).toHaveLength(1);
    expect(checks[0]?.type === "STATE_BASED_ACTIONS" && checks[0].actions.map((a) => a.kind)).toStrictEqual([
      "lethalDamage",
      "zeroToughness",
    ]);
  });

  it("aren't checked in the middle of a resolution (CR 704.4)", () => {
    // Bears with 1 damage: Shot and Boost deals 1 (lethal for a 2/2), then gives +1/+1 (now 3/3). No check comes
    // between the two effects, so the Bears survive.
    const g = start({
      seed: 1,
      players: [
        playerSetup("p1", { library: ["forest"], hand: [SHOT_AND_BOOST], battlefield: [permanent("mountain")] }),
        playerSetup("p2", { library: ["forest"], battlefield: [{ ...permanent(BEARS), damage: 1 }] }),
      ],
      opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
      ruleModifiers: [],
    });
    const bears = g.state.zones.battlefield[1] as ObjectId;
    let next = take(g, (a) => a.type === "CAST_SPELL");
    const target = (a: Action) =>
      a.type === "ANSWER" && a.answer.kind === "chooseTarget" && JSON.stringify(a.answer.target).includes(bears);
    next = take(take(next, target), target);
    while (next.state.pending?.kind === "payMana") {
      next = take(next, (a) => (a.type === "ANSWER" && a.answer.kind === "payMana") || a.type === "ACTIVATE_ABILITY");
    }
    next = passBoth(next);
    expect(next.state.zones.battlefield).toContain(bears);
    expect(next.state.objects[bears]).toMatchObject({ damage: 2 });
  });
});

describe("another cleanup step (CR 514.3a)", () => {
  /** p1's end step, with a Hill Giant that will die in cleanup (see above) and a Mountain. */
  function dyingInCleanup(): Game {
    const g = start({
      seed: 1,
      players: [
        playerSetup("p1", {
          library: ["forest", "forest"],
          hand: ["shock"],
          battlefield: [permanent(HILL_GIANT), permanent("mountain")],
        }),
        playerSetup("p2", { library: ["forest", "forest"] }),
      ],
      opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "end" } },
      ruleModifiers: [],
    });
    const giant = g.state.zones.battlefield[0] as ObjectId;
    const state: GameState = {
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
    return passBoth({ state, events: [] });
  }

  it("follows a spell cast while players had priority in cleanup", () => {
    let g = dyingInCleanup();
    g = take(g, (a) => a.type === "CAST_SPELL");
    g = take(g, (a) => a.type === "ANSWER" && a.answer.kind === "chooseTarget" && a.answer.target.kind === "player");
    while (g.state.pending?.kind === "payMana") {
      g = take(g, (a) => (a.type === "ANSWER" && a.answer.kind === "payMana") || a.type === "ACTIVATE_ABILITY");
    }
    g = passBoth(g); // Shock resolves; p1 gets priority again in the same cleanup step
    expect(g.state.turn).toMatchObject({ number: 3, step: "cleanup" });
    g = passBoth(g);
    expect(g.events.filter((e) => e.type === "STEP_BEGAN" && e.step === "cleanup")).toHaveLength(2);
    expect(g.state.turn).toMatchObject({ number: 4 });
  });

  it("empties mana pools before it begins (CR 500.5)", () => {
    let g = dyingInCleanup();
    g = take(g, (a) => a.type === "ACTIVATE_ABILITY");
    expect(g.state.players.p1?.manaPool.R).toBe(1);
    const before = g.events.length;
    g = passBoth(g);
    const types = g.events.slice(before).map((e) => (e.type === "STEP_BEGAN" ? `STEP_BEGAN ${e.step}` : e.type));
    expect(types.indexOf("MANA_EMPTIED")).toBeLessThan(types.indexOf("STEP_BEGAN cleanup"));
    expect(types).toContain("MANA_EMPTIED");
  });
});

describe('drawing from an empty library under "you can\'t lose the game" (CR 704.5b, 104.3c)', () => {
  /** p1's turn, p1 having tried to draw from an empty library since the last check, controlling the test Angel. */
  function triedToDraw(angelDamage: number): GameState {
    const g = game("precombatMain", [TEST_ANGEL]);
    const angel = g.state.zones.battlefield[0] as ObjectId;
    const players = { ...g.state.players, p1: { ...g.state.players.p1, attemptedDrawFromEmptyLibrary: true } };
    return edit({ ...g.state, players } as GameState, angel, { damage: angelDamage });
  }

  it("doesn't lose while the Angel is there at the check, and the attempt is cleared, so it never counts later", () => {
    const checked = checkStateBasedActions(triedToDraw(0), TEST_CARDS);
    expect(checked.performed).toBe(false);
    expect(checked.state.players.p1?.attemptedDrawFromEmptyLibrary).toBe(false);
    expect(checked.state.result).toBeNull();
  });

  it("dies in the same check as the attempt is looked at: the attempt is cleared then, so the repeated check finds no loss", () => {
    const first = checkStateBasedActions(triedToDraw(1), TEST_CARDS);
    expect(first.performed).toBe(true); // the Angel, with lethal damage, is destroyed
    const again = checkStateBasedActions(first.state, TEST_CARDS);
    expect(again.state.result).toBeNull();
  });

  it("loses if the Angel is gone by the check", () => {
    const state = triedToDraw(0);
    const gone = { ...state, zones: { ...state.zones, battlefield: [] } };
    const checked = checkStateBasedActions(gone, TEST_CARDS);
    expect(checked.state.result?.winner).toBe("p2");
  });
});
