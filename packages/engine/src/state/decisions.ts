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
  /** Keep this opening hand or take a mulligan (CR 103.5). */
  | { kind: "mulligan"; mulligansTaken: number };
