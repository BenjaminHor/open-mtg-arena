// Actions: every input to the engine. Each one answers the current `PendingDecision`, except `CONCEDE`.

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
  /** How much of each type of mana to spend (CR 601.2h). */
  | { kind: "payMana"; payment: ManaPool }
  /** Cancel the cast: the whole action is reversed (CR 734.1). */
  | { kind: "cancelCast" };
