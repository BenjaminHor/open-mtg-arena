// Pending decisions: whatever the game is waiting for a player to do. The engine never blocks.
// It stores one of these in `GameState.pending` and stops (docs/architecture.md, "Actions and decisions").
//
// Each task adds the kinds it needs (casting choices, attackers, blockers, dividing damage, ...).

import type { Effect, ManaCost } from "../cards/types.ts";
import type { Attack, Block, CombatDivision } from "./combat.ts";
import type { EffectContext } from "./effects.ts";
import type { DecisionId, ObjectId, OracleId, PlayerId } from "./ids.ts";
import type { Target } from "./objects.ts";
import type { PendingTrigger } from "./triggers.ts";
import type { WorkItem } from "./work.ts";
import type { ZoneRef } from "./zones.ts";

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
   * Declare attackers (CR 508.1), one creature per answer; `chosen` holds those already chosen. Each answer is checked
   * as it's added; nothing happens until the player finishes, and then the declaration is carried out.
   */
  | { kind: "declareAttackers"; chosen: Attack[] }
  /** Declare blockers (CR 509.1), one block per answer, the same way. */
  | { kind: "declareBlockers"; chosen: Block[] }
  /**
   * Divide a creature's combat damage among its recipients (CR 510.1c): an attacker's blockers, and with trample then the
   * player it attacks (CR 702.19b), in any way that adds up to `amount`. One answer per recipient but the last, in
   * `recipients` order, giving it 0 up to what's left; the last gets the rest. With trample, `lethal` is the damage each
   * blocker needs before the player can get any; null without. `assigned` holds the amounts given so far; `divided`,
   * the creatures already divided this step.
   */
  | {
      kind: "assignDamage";
      source: ObjectId;
      recipients: Target[];
      lethal: number[] | null;
      amount: number;
      assigned: number[];
      divided: CombatDivision[];
    }
  /** While casting a spell or activating an ability: choose the target for this instance of "target" (CR 601.2c). */
  | { kind: "chooseTarget"; object: ObjectId; instance: number }
  /**
   * While casting or activating, first: announce the value of X (CR 601.2b, 107.3a). Any whole number from 0 is
   * accepted; `upTo` is only how far `legalActions` lists them, the most the player could pay for now.
   */
  | { kind: "announceX"; object: ObjectId; upTo: number }
  /**
   * While casting or activating: announce how many targets this instance of "target" will have, when the text
   * allows a range, before choosing them (CR 601.2c). `max` is already limited to what can be chosen.
   */
  | { kind: "chooseTargetCount"; object: ObjectId; instance: number; min: number; max: number }
  /**
   * While casting or activating: announce how much of `amount` the next target gets (CR 601.2d), one target at a
   * time, in the order they were chosen; `shares` holds what's given so far. The last target gets the rest.
   */
  | { kind: "divide"; object: ObjectId; instance: number; amount: number; targets: Target[]; shares: number[] }
  /**
   * While casting or activating: pay the mana cost (CR 601.2g–h). Mana abilities may be activated while this is
   * pending (CR 605.3a); then the answer is a payment from the pool, or cancelling the cast or activation.
   */
  | { kind: "payMana"; object: ObjectId; cost: ManaCost }
  /**
   * While activating: choose a permanent to sacrifice for the cost (CR 601.2h, 701.21a). It's sacrificed when the whole
   * cost is paid; until then the player can cancel.
   */
  | { kind: "chooseSacrifice"; object: ObjectId }
  /**
   * While a spell or ability resolves: choose cards for one of its effects (CR 608.2d), one per answer, by position in
   * `options`, which are in a fixed order (oracle id, then object id) that says nothing about how the cards got there
   * (D-062). `chosen` holds the positions so far; once `max` are chosen, or the player finishes with at least `min`,
   * `resume` runs with them. Nothing happens before that.
   */
  | {
      kind: "chooseCards";
      purpose: ChoosePurpose;
      options: ObjectId[];
      min: number;
      max: number;
      chosen: number[];
      /**
       * True for "any number" (a search for all copies): only `finishChoosing` ends it, never reaching `max`, which is
       * hidden; ending there would tell the other players how many there were (D-062).
       */
      endsOnlyOnFinish: boolean;
      /** The whole zone the chooser is shown, by identity only (a searched library, a revealed hand), or null. */
      seen: Seen | null;
      resume: { effect: Effect; context: EffectContext };
    }
  /**
   * Several of this player's triggered abilities wait to go on the stack: which goes on next (CR 603.3b). The ones put
   * on first resolve last. `batch` is every trigger still to be put on; `priorityTo`, who gets priority after.
   */
  | { kind: "orderTriggers"; batch: PendingTrigger[]; priorityTo: PlayerId }
  /**
   * While a spell or ability resolves: a "you may" choice (CR 608.2d): "you may shuffle", or a triggered ability's "you
   * may" (CR 603.5). Yes runs `resume`, the work it chose to do; no does nothing.
   */
  | { kind: "chooseYesNo"; purpose: "shuffle" | "optional"; resume: WorkItem[] };

/** What a `chooseCards` decision's cards are chosen for, so a player is told why. */
export type ChoosePurpose = "discard" | "putOntoBattlefield" | "search" | "putOnTop" | "sacrifice";

/** Cards shown to one player by what they are, in a fixed order (D-062), and the zone they're in. */
export type Seen = { from: ZoneRef; cards: OracleId[] };
