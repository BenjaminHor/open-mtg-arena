// The untap step's "doesn't untap" effects (CR 502.3) where no pool card can reach the case: one "its controller"
// effect on several permanents, of which only some are the active player's, and one on a permanent left untapped.

import { describe, expect, it } from "vitest";
import { untapStep } from "../../src/game/untap-step.ts";
import type { ContinuousEffect, GameState, ObjectId } from "../../src/index.ts";
import { BEARS, TEST_CARDS } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

const bears = (tapped: boolean) => ({ oracleId: BEARS, tapped, summoningSick: false, damage: 0, counters: {} });

/** p1's turn, with a tapped Bears for each player. */
function board(p1Tapped = true): GameState {
  return start({
    seed: 1,
    players: [
      playerSetup("p1", { library: ["forest"], battlefield: [bears(p1Tapped)] }),
      playerSetup("p2", { library: ["forest"], battlefield: [bears(true)] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  }).state;
}

const frost = (affected: ObjectId[]): ContinuousEffect => ({
  source: affected[0] as ObjectId,
  controller: "p2",
  timestamp: 999,
  duration: "nextUntapStep",
  affected,
  change: { kind: "doesntUntap", during: "itsController" },
});

describe("doesn't untap during its controller's next untap step (CR 502.3)", () => {
  it("keeps the active player's permanent tapped, then drops only it, keeping the other player's for their step", () => {
    const state = board();
    const [mine, theirs] = state.zones.battlefield as ObjectId[];
    const effect = frost([mine as ObjectId, theirs as ObjectId]);
    const after = untapStep({ ...state, effects: [...state.effects, effect] }, TEST_CARDS);
    const obj = after.state.objects[mine as ObjectId];
    expect(obj?.kind === "card" && obj.tapped).toBe(true);
    expect(after.state.effects).toContainEqual({ ...effect, affected: [theirs] });
    expect(after.events.some((e) => e.type === "EFFECT_ENDED")).toBe(false);
  });

  it("ends even when its permanent wasn't tapped then (Wall of Frost's ruling)", () => {
    const state = board(false);
    const [mine] = state.zones.battlefield as ObjectId[];
    const effect = frost([mine as ObjectId]);
    const after = untapStep({ ...state, effects: [...state.effects, effect] }, TEST_CARDS);
    expect(after.state.effects).not.toContainEqual(effect);
    expect(after.events.map((e) => e.type)).toStrictEqual(["EFFECT_ENDED"]);
  });
});
