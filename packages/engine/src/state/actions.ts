// Actions: every input to the engine. Each one answers the current `PendingDecision`, except `CONCEDE`.

import type { DecisionId, ObjectId, PlayerId } from "./ids.ts";

export type Action =
  | { type: "PASS_PRIORITY"; decisionId: DecisionId; player: PlayerId } // CR 117.3d
  | { type: "PLAY_LAND"; decisionId: DecisionId; player: PlayerId; object: ObjectId } // CR 305.1
  | { type: "CAST_SPELL"; decisionId: DecisionId; player: PlayerId; object: ObjectId } // CR 601.2
  | {
      type: "ACTIVATE_ABILITY";
      decisionId: DecisionId;
      player: PlayerId;
      object: ObjectId;
      /** Which ability of the object, as indexed in its card definition. */
      ability: number;
    } // CR 602.2
  | { type: "ANSWER"; decisionId: DecisionId; player: PlayerId; answer: Answer }
  /** A player can concede at any time (CR 104.3a), so this doesn't answer a decision. */
  | { type: "CONCEDE"; player: PlayerId };

/** The answer to a decision other than priority. Its `kind` matches the decision's. */
export type Answer = { kind: "mulligan"; choice: "keep" | "mulligan" };
