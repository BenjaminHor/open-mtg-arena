// The untap step's "doesn't untap" effects (CR 502.3), where no pool card can reach the case: an effect naming one
// player's next untap step, on a permanent another player controls when their own untap step comes first.

import { describe, expect, it } from "vitest";
import { untapStep } from "../../src/game/untap-step.ts";
import type { GameState, ObjectId } from "../../src/index.ts";
import { BEARS, TEST_CARDS } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

function p1Turn(): GameState {
  return start({
    seed: 1,
    players: [
      playerSetup("p1", {
        library: ["forest"],
        battlefield: [{ oracleId: BEARS, tapped: true, summoningSick: false, damage: 0, counters: {} }],
      }),
      playerSetup("p2", { library: ["forest"] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  }).state;
}

describe("doesn't untap during a player's next untap step (CR 502.3)", () => {
  it("doesn't stop another player's untap step, and lasts until the named player's", () => {
    const state = p1Turn();
    const bears = state.zones.battlefield[0] as ObjectId;
    const sleep = {
      source: bears,
      controller: "p2" as const,
      timestamp: 999,
      duration: "nextUntapStep" as const,
      affected: [bears],
      change: { kind: "doesntUntap" as const, during: "p2" as const },
    };
    const after = untapStep({ ...state, effects: [...state.effects, sleep] }, TEST_CARDS);
    const obj = after.state.objects[bears];
    expect(obj?.kind === "card" && obj.tapped).toBe(false);
    expect(after.state.effects).toContainEqual(sleep);
  });

  it("ends one naming the active player even when its permanent wasn't tapped (Wall of Frost's ruling)", () => {
    const state = p1Turn();
    const bears = state.zones.battlefield[0] as ObjectId;
    const frost = {
      source: bears,
      controller: "p2" as const,
      timestamp: 999,
      duration: "nextUntapStep" as const,
      affected: [bears],
      change: { kind: "doesntUntap" as const, during: "itsController" as const },
    };
    const untapped = { ...state.objects[bears], tapped: false } as GameState["objects"][ObjectId];
    const before = { ...state, objects: { ...state.objects, [bears]: untapped }, effects: [...state.effects, frost] };
    const after = untapStep(before, TEST_CARDS);
    expect(after.state.effects).not.toContainEqual(frost);
    expect(after.events.map((e) => e.type)).toStrictEqual(["EFFECT_ENDED"]);
  });
});
