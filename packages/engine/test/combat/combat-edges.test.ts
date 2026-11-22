// Combat behaviour that mutation testing (M2-15b, D-139) showed no test pinned down: a change to the code went
// unnoticed. Each test here fails if that change is made again.

import { describe, expect, it } from "vitest";
import { type Action, applyAction, type GameState, type ObjectId } from "../../src/index.ts";
import { BEARS, FOREST, HILL_GIANT, TEST_CARDS } from "../support/cards.ts";
import { answer, type Game, passBoth, playerSetup, start } from "../support/game.ts";

const permanent = (oracleId: string, summoningSick = false) => ({
  oracleId,
  tapped: false,
  summoningSick,
  damage: 0,
  counters: {},
});

function combatGame(p1: string[], p2: string[], sick: string[] = []): Game {
  return start({
    seed: 1,
    players: [
      playerSetup("p1", {
        library: [FOREST, FOREST],
        battlefield: [...p1.map((o) => permanent(o)), ...sick.map((o) => permanent(o, true))],
      }),
      playerSetup("p2", { library: [FOREST, FOREST], battlefield: p2.map((o) => permanent(o)) }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  });
}

/** The answer action for the pending decision, without applying it. */
function answerAction(state: GameState, a: Extract<Action, { type: "ANSWER" }>["answer"]): Action {
  const pending = state.pending;
  if (pending === null) throw new Error("nothing pending");
  return { type: "ANSWER", decisionId: pending.id, player: pending.player, answer: a };
}

describe("a declared attack must be one of the legal ones (CR 508.1a)", () => {
  it("refuses a summoning-sick creature, and an attack on a player who isn't an opponent", () => {
    let game = combatGame([BEARS], [], [HILL_GIANT]);
    const [bears, giant] = game.state.zones.battlefield as [ObjectId, ObjectId];
    game = passBoth(passBoth(game));
    expect(game.state.pending?.kind).toBe("declareAttackers");
    // A creature that came under its controller's control this turn can't attack (CR 302.6).
    const sick = answerAction(game.state, { kind: "declareAttacker", attack: { attacker: giant, defender: "p2" } });
    expect(applyAction(game.state, sick, TEST_CARDS)).toMatchObject({ ok: false, error: { code: "illegalAction" } });
    // An attacking creature attacks an opponent (CR 508.1b): never its own controller.
    const self = answerAction(game.state, { kind: "declareAttacker", attack: { attacker: bears, defender: "p1" } });
    expect(applyAction(game.state, self, TEST_CARDS)).toMatchObject({ ok: false, error: { code: "illegalAction" } });
    const fine = answerAction(game.state, { kind: "declareAttacker", attack: { attacker: bears, defender: "p2" } });
    expect(applyAction(game.state, fine, TEST_CARDS).ok).toBe(true);
  });
});

describe("only a requirement makes a creature attack (CR 508.1d)", () => {
  it("doesn't count another continuous effect on the creature, such as a pump, as a requirement", () => {
    let game = combatGame([BEARS], []);
    const [bears] = game.state.zones.battlefield as [ObjectId];
    const pumped = {
      source: bears,
      controller: "p1" as const,
      timestamp: 1000,
      duration: "endOfTurn" as const,
      affected: [bears],
      change: { kind: "modifyPT" as const, power: 3, toughness: 3 },
    };
    game = { ...game, state: { ...game.state, effects: [pumped] } };
    game = passBoth(passBoth(game));
    expect(game.state.pending?.kind).toBe("declareAttackers");
    const none = answerAction(game.state, { kind: "finishDeclaring" });
    expect(applyAction(game.state, none, TEST_CARDS).ok).toBe(true);
  });
});

describe("dividing an attacker's combat damage among its blockers (CR 510.1c)", () => {
  function assigning(): Game {
    let game = combatGame([HILL_GIANT], [BEARS, BEARS]);
    const [giant, b1, b2] = game.state.zones.battlefield as [ObjectId, ObjectId, ObjectId];
    game = passBoth(passBoth(game));
    game = answer(game, { kind: "declareAttacker", attack: { attacker: giant, defender: "p2" } });
    game = answer(game, { kind: "finishDeclaring" });
    game = passBoth(game);
    game = answer(game, { kind: "declareBlocker", block: { blocker: b1, attacker: giant } });
    game = answer(game, { kind: "declareBlocker", block: { blocker: b2, attacker: giant } });
    game = answer(game, { kind: "finishDeclaring" });
    game = passBoth(game);
    expect(game.state.pending?.kind).toBe("assignDamage");
    return game;
  }

  it("gives each blocker a whole amount from 0 to what's left: more, less than 0 or a fraction is refused", () => {
    const game = assigning();
    for (const amount of [4, -1, 1.5]) {
      const action = answerAction(game.state, { kind: "assignDamage", amount });
      expect(applyAction(game.state, action, TEST_CARDS)).toMatchObject({ ok: false });
    }
    for (const amount of [0, 3]) {
      const action = answerAction(game.state, { kind: "assignDamage", amount });
      expect(applyAction(game.state, action, TEST_CARDS).ok).toBe(true);
    }
  });

  it("deals no damage to a blocker given 0: a source deals no damage of 0 (CR 120.8)", () => {
    const game = assigning();
    const [, b1, b2] = game.state.zones.battlefield as [ObjectId, ObjectId, ObjectId];
    const result = applyAction(game.state, answerAction(game.state, { kind: "assignDamage", amount: 3 }), TEST_CARDS);
    if (!result.ok) throw new Error(result.error.message);
    const dealt = result.events.flatMap((e) => (e.type === "DAMAGE_DEALT" ? [e] : []));
    expect(dealt.filter((e) => e.to.kind === "object" && e.to.object === b1).map((e) => e.amount)).toStrictEqual([3]);
    expect(dealt.some((e) => e.to.kind === "object" && e.to.object === b2)).toBe(false);
    expect(dealt.every((e) => e.amount > 0)).toBe(true);
  });
});
