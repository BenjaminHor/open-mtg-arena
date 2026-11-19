// The work queue (docs/architecture.md, "Running the game: the work queue"). Work that's waiting to happen lives in
// GameState, not on the JavaScript call stack, so the game can stop for a decision at any point and every wait is a
// plain-data snapshot.

import type { ObjectId, PlayerId } from "./ids.ts";

export type WorkItem =
  /**
   * A player receives priority (CR 117). State-based actions and putting triggered abilities on the stack happen first
   * (CR 117.5), once those exist (M1-12).
   */
  | { kind: "givePriority"; player: PlayerId }
  /** The current step or phase ends, and the next one begins (CR 500.2). */
  | { kind: "endStep" }
  /** The top object of the stack starts to resolve (CR 405.5, 608): this queues the steps of its resolution. */
  | { kind: "resolveTopOfStack" }
  /** The final part of an object's resolution (CR 608.2n, 608.3a). */
  | { kind: "finishResolving"; object: ObjectId }
  /** The rest of the cleanup step, once the active player has chosen any discards (CR 514). */
  | { kind: "finishCleanup"; chosen: ObjectId[] };
