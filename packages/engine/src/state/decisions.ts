// Pending decisions: whatever the game is waiting for a player to do. The engine never blocks.
// It stores one of these in `GameState.pending` and stops (docs/architecture.md, "Actions and decisions").
//
// Each task adds the kinds it needs (casting choices, attackers, blockers, dividing damage, ...).

import type { ManaCost } from "../cards/types.ts";
import type { Attack, AttackerDivision, Block } from "./combat.ts";
import type { DecisionId, ObjectId, PlayerId } from "./ids.ts";

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
  | { kind: "mulliganBottom"; remaining: number }
  /**
   * In the cleanup step, choose a card to discard because the hand is over the maximum hand size (CR 514.1, 402.2).
   * Asked once per card; `remaining` counts this one, and `chosen` holds the cards already chosen. Once all are chosen
   * they're discarded together, as one action.
   */
  | { kind: "discardToHandSize"; remaining: number; chosen: ObjectId[] }
  /**
   * Declare attackers (CR 508.1), one creature per answer; `chosen` holds those already chosen. Nothing happens until
   * the player finishes: then the whole declaration is checked and carried out.
   */
  | { kind: "declareAttackers"; chosen: Attack[] }
  /** Declare blockers (CR 509.1), one block per answer, the same way. */
  | { kind: "declareBlockers"; chosen: Block[] }
  /**
   * Divide an attacker's combat damage among the creatures blocking it (CR 510.1c), in any way that adds up to
   * `amount`. Asked for each attacker with two or more blockers; `divided` holds the attackers already divided.
   */
  | { kind: "assignDamage"; attacker: ObjectId; blockers: ObjectId[]; amount: number; divided: AttackerDivision[] }
  /** While casting: choose the target for this instance of "target" (CR 601.2c). */
  | { kind: "chooseTarget"; spell: ObjectId; instance: number }
  /**
   * While casting: pay the mana cost (CR 601.2g–h). Mana abilities may be activated while this is pending (CR 605.3a);
   * then the answer is a payment from the pool, or cancelling the cast.
   */
  | { kind: "payMana"; spell: ObjectId; cost: ManaCost };
