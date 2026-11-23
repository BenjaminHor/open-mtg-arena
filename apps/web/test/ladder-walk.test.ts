// The phase ladder walks through each phase the game passes (D-175; the owner: "it steps through each phase as it
// passes - we should avoid immediate jumps between the "main" phases").

import type { PlayerId, Step, ViewEvent } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { boardModel } from "../src/board-model/board-model.ts";
import { ladderWalk, type TurnPlace, WALK_MS, walkStepMs } from "../src/interaction/ladder-walk.ts";
import { playFrom } from "./fixture-views.ts";

const began = (step: Step, activePlayer: PlayerId = "p1", turn = 3): ViewEvent => ({
  type: "STEP_BEGAN",
  turn,
  step,
  activePlayer,
});
const at = (step: Step, activePlayer: PlayerId = "p1", turn = 3): TurnPlace => ({ turn, step, activePlayer });

describe("the ladder's walk", () => {
  it("passes through combat from main 1 to main 2 when no one attacks (CR 508.8: blockers and damage skipped)", () => {
    const events = [
      began("beginningOfCombat"),
      began("declareAttackers"),
      began("endOfCombat"),
      began("postcombatMain"),
    ];
    expect(ladderWalk(events, at("precombatMain"), at("postcombatMain"))).toEqual([at("beginningOfCombat")]);
  });

  it("walks a whole turn's phases from its beginning: each phase once, the resting one lit by the view", () => {
    const events = (["untap", "upkeep", "draw", "precombatMain", "beginningOfCombat", "endOfCombat"] as Step[])
      .map((s) => began(s))
      .concat(began("postcombatMain"));
    expect(ladderWalk(events, at("cleanup", "p2", 2), at("postcombatMain"))).toEqual([
      at("untap"),
      at("precombatMain"),
      at("beginningOfCombat"),
    ]);
  });

  it("walks only the turn the view shows: the end of the last turn isn't lit on the new turn's screen", () => {
    const events = [
      began("end"),
      began("cleanup"),
      began("untap", "p2", 4),
      began("upkeep", "p2", 4),
      began("draw", "p2", 4),
      began("precombatMain", "p2", 4),
    ];
    expect(ladderWalk(events, at("postcombatMain"), at("precombatMain", "p2", 4))).toEqual([at("untap", "p2", 4)]);
  });

  it("walks an extra turn's beginning as its own turn, the same player's (CR 500.7)", () => {
    const events = [began("end"), began("cleanup"), began("untap", "p1", 4), began("precombatMain", "p1", 4)];
    expect(ladderWalk(events, at("postcombatMain"), at("precombatMain", "p1", 4))).toEqual([at("untap", "p1", 4)]);
  });

  it("carries on a walk a new view cut short: what it hadn't reached, then the old view's phase, then the new", () => {
    // Lit: combat, on the way to main 2; a new view arrives, the game now in the end step.
    const pending = [at("postcombatMain")];
    expect(ladderWalk([began("end")], at("beginningOfCombat"), at("end"), pending)).toEqual([at("postcombatMain")]);
  });

  it("doesn't walk when the game stays in its phase, or when there's nowhere to start from", () => {
    expect(ladderWalk([], at("precombatMain"), at("precombatMain"))).toEqual([]);
    expect(ladderWalk([began("upkeep")], null, at("upkeep"))).toEqual([]);
    expect(ladderWalk([began("draw")], at("upkeep"), at("draw"))).toEqual([]);
  });

  it("fits a walk inside a held frame's hold, and takes its own time at the person's decision", () => {
    expect(walkStepMs(0, 3)).toBe(WALK_MS);
    expect(walkStepMs(1000, 1)).toBe(WALK_MS);
    expect(walkStepMs(600, 5) * 6).toBeLessThanOrEqual(600);
  });
});

describe("the ladder while it walks (the board model's `ladderAt`)", () => {
  const m = playFrom({
    turn: { number: 5, activePlayer: "p1", step: "precombatMain" },
    players: {
      p1: { life: 20, hand: [], battlefield: ["Grizzly Bears"], library: ["Forest", "Forest"] },
      p2: { life: 20, hand: [], battlefield: [], library: ["Forest", "Forest"] },
    },
  });
  const shown = m.shown();
  const phone = { width: 812, height: 375 };

  it("lights the phase walked through instead of the view's step, on whose turn it is", () => {
    const model = boardModel(shown, phone, undefined, {
      handOpen: false,
      ladderAt: { step: "beginningOfCombat", activePlayer: "p1" },
    });
    expect(model.overlay.ladder.icons.filter((i) => i.lit).map((i) => i.label)).toEqual(["Combat"]);
    // Kept short while walking: combat stays one rung rather than opening and closing.
    expect(model.overlay.ladder.icons).toHaveLength(5);
    expect(model.overlay.opponentLadder).toBeNull();
    const theirs = boardModel(shown, phone, undefined, {
      handOpen: false,
      ladderAt: { step: "end", activePlayer: "p2" },
    });
    expect(theirs.overlay.opponentLadder?.icons.find((i) => i.lit)?.label).toBe("End");
  });
});
