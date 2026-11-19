// Pending decisions: whatever the game is waiting for a player to do. The engine never blocks.
// It stores one of these in `GameState.pending` and stops (docs/architecture.md, "Actions and decisions").
//
// Each task adds the kinds it needs (casting choices, attackers, blockers, dividing damage, ...).

import type { DecisionId, PlayerId } from "./ids.ts";

export type PendingDecision = {
  id: DecisionId;
  player: PlayerId;
} & DecisionKind;

export type DecisionKind =
  /**
   * The player has priority (CR 117). The options aren't stored: `legalActions()` computes them from the state,
   * so they can't fall out of sync with it.
   */
  | { kind: "priority" }
  /** Choose who takes the first turn (CR 103.1). Any player may be chosen, including the one choosing. */
  | { kind: "chooseStartingPlayer" }
  /**
   * Keep this hand or take a mulligan (CR 103.5). `mulligansTaken` counts the mulligans already taken. A mulligan
   * isn't allowed once the hand would be zero cards.
   */
  | { kind: "mulligan"; mulligansTaken: number }
  /**
   * After a mulligan, put one card from hand on the bottom of the library (CR 103.5). Asked once per card, so the
   * answers also set the order: each card goes below the ones before it. `remaining` counts this one.
   */
  | { kind: "mulliganBottom"; remaining: number };
