// The phase ladder walks through each phase the game passes (D-175; the owner: "it steps through each phase as it
// passes - we should avoid immediate jumps between the "main" phases").

import type { PlayerId, Step, ViewEvent } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { ladderWalk } from "../src/interaction/ladder-walk.ts";

const began = (step: Step, activePlayer: PlayerId = "p1", turn = 3): ViewEvent => ({
  type: "STEP_BEGAN",
  turn,
  step,
  activePlayer,
});

describe("the ladder's walk", () => {
  it("passes through combat from main 1 to main 2 when no one attacks (CR 508.8: blockers and damage skipped)", () => {
    const events = [
      began("beginningOfCombat"),
      began("declareAttackers"),
      began("endOfCombat"),
      began("postcombatMain"),
    ];
    const walk = ladderWalk(
      events,
      { step: "precombatMain", activePlayer: "p1" },
      { step: "postcombatMain", activePlayer: "p1" },
    );
    expect(walk).toEqual([{ step: "beginningOfCombat", activePlayer: "p1" }]);
  });

  it("walks across a turn: the end of one, then the next player's beginning, resting in their main 1", () => {
    const events = [
      began("end"),
      began("cleanup"),
      began("untap", "p2", 4),
      began("upkeep", "p2", 4),
      began("draw", "p2", 4),
      began("precombatMain", "p2", 4),
    ];
    const walk = ladderWalk(
      events,
      { step: "postcombatMain", activePlayer: "p1" },
      { step: "precombatMain", activePlayer: "p2" },
    );
    expect(walk).toEqual([
      { step: "end", activePlayer: "p1" },
      { step: "untap", activePlayer: "p2" },
    ]);
  });

  it("doesn't walk when the game stays in its phase, or when there's nowhere to start from", () => {
    expect(
      ladderWalk([], { step: "precombatMain", activePlayer: "p1" }, { step: "precombatMain", activePlayer: "p1" }),
    ).toEqual([]);
    expect(ladderWalk([began("upkeep")], null, { step: "upkeep", activePlayer: "p1" })).toEqual([]);
    // Upkeep to draw: one phase, Beginning.
    expect(
      ladderWalk([began("draw")], { step: "upkeep", activePlayer: "p1" }, { step: "draw", activePlayer: "p1" }),
    ).toEqual([]);
  });
});
