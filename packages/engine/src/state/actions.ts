// Actions: every input to the engine. Each one answers the current `PendingDecision`, except `CONCEDE`.

import type { Color } from "../cards/types.ts";
import type { Attack, Block } from "./combat.ts";
import type { DecisionId, ObjectId, PlayerId } from "./ids.ts";
import type { ManaPool } from "./mana.ts";
import type { AbilityRef, Target } from "./objects.ts";

export type Action =
  | { type: "PASS_PRIORITY"; decisionId: DecisionId; player: PlayerId } // CR 117.3d
  | { type: "PLAY_LAND"; decisionId: DecisionId; player: PlayerId; object: ObjectId } // CR 305.1
  | { type: "CAST_SPELL"; decisionId: DecisionId; player: PlayerId; object: ObjectId } // CR 601.2
  | {
      type: "ACTIVATE_ABILITY";
      decisionId: DecisionId;
      player: PlayerId;
      object: ObjectId;
      /** Which of the object's abilities (D-028). */
      ability: AbilityRef;
      /**
       * For a mana ability that adds "one mana of any color" only: the color chosen (CR 105.4), since it resolves at
       * once (CR 605.3b, D-068). Left out for every other ability.
       */
      color?: Color;
    } // CR 602.2
  | { type: "ANSWER"; decisionId: DecisionId; player: PlayerId; answer: Answer }
  /** A player can concede at any time (CR 104.3a), so this doesn't answer a decision. */
  | { type: "CONCEDE"; player: PlayerId };

/** The answer to a decision other than priority. Its `kind` matches the decision's. */
export type Answer =
  | { kind: "chooseStartingPlayer"; player: PlayerId }
  | { kind: "mulligan"; choice: "keep" | "mulligan" }
  | { kind: "mulliganBottom"; object: ObjectId }
  | { kind: "discardToHandSize"; object: ObjectId }
  | { kind: "chooseTarget"; target: Target }
  /** The value of X (CR 107.3a). */
  | { kind: "announceX"; value: number }
  /** How many targets this instance will have (CR 601.2c). */
  | { kind: "chooseTargetCount"; count: number }
  /** The next target's share of a divided effect (CR 601.2d). */
  | { kind: "divide"; amount: number }
  /** The permanent to sacrifice for the cost (CR 701.21a). */
  | { kind: "chooseSacrifice"; object: ObjectId }
  /** How much of each type of mana to spend (CR 601.2h). */
  | { kind: "payMana"; payment: ManaPool }
  /** Cancel the cast or activation in progress: the whole action is reversed (CR 734.1, D-035). */
  | { kind: "cancelCast" }
  /** Add one attacker to the declaration (CR 508.1a). */
  | { kind: "declareAttacker"; attack: Attack }
  /** Add one block to the declaration (CR 509.1a). */
  | { kind: "declareBlocker"; block: Block }
  /** The declaration of attackers or blockers is complete (it may be empty). */
  | { kind: "finishDeclaring" }
  /** How much of the attacker's combat damage goes to the next blocker in the decision's order (CR 510.1c). */
  | { kind: "assignDamage"; amount: number }
  /** One more card for a `chooseCards` decision, by its position in the decision's `options` (D-062). */
  | { kind: "chooseCard"; option: number }
  /** No more cards for a `chooseCards` decision: allowed once its minimum is chosen. */
  | { kind: "finishChoosing" }
  /** The answer to a "you may" (`chooseYesNo`). */
  | { kind: "chooseYesNo"; yes: boolean };
