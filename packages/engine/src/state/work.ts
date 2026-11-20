// The work queue (docs/architecture.md, "Running the game: the work queue"). Work that's waiting to happen lives in
// GameState, not on the JavaScript call stack, so the game can stop for a decision at any point and every wait is a
// plain-data snapshot.

import type { Effect } from "../cards/types.ts";
import type { Attack, Block, CombatDivision } from "./combat.ts";
import type { EffectContext } from "./effects.ts";
import type { DidNotResolve } from "./events.ts";
import type { ObjectId, PlayerId } from "./ids.ts";
import type { PendingTrigger } from "./triggers.ts";

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
  /**
   * One effect of a resolving spell or ability, in the order written (CR 608.2c). `chosen` is null when it first runs;
   * an effect that asks for cards (`chooseCards`) runs again with the cards chosen (CR 608.2d).
   */
  | { kind: "runEffect"; effect: Effect; context: EffectContext; chosen: ObjectId[] | null }
  /** The final part of an object's resolution (CR 608.2n, 608.3a). */
  | { kind: "finishResolving"; object: ObjectId }
  /**
   * The spell or ability doesn't resolve: every target is illegal (CR 608.2b), or a triggered ability's intervening if
   * is false (CR 608.2a). A spell goes to its owner's graveyard; an ability ceases to exist.
   */
  | { kind: "doesNotResolve"; object: ObjectId; reason: DidNotResolve }
  /** The cleanup step's check for state-based actions and waiting triggers, after the CR 514.2 action (CR 514.3a). */
  | { kind: "cleanupCheck" }
  /** All players passed in a cleanup step that gave them priority, so another cleanup step begins (CR 514.3a). */
  | { kind: "anotherCleanupStep" }
  /** The declare attackers step's turn-based action (CR 508.1), with the attackers chosen so far. */
  | { kind: "declareAttackers"; chosen: Attack[] }
  /** The declare blockers step's turn-based action (CR 509.1), with the blocks chosen so far. */
  | { kind: "declareBlockers"; chosen: Block[] }
  /** The combat damage step's turn-based action (CR 510.1–510.2), with the divisions chosen so far. */
  | { kind: "combatDamage"; divisions: CombatDivision[] }
  /** The rest of the cleanup step, once the active player has chosen any discards (CR 514). */
  | { kind: "finishCleanup"; chosen: ObjectId[] }
  /** A triggered ability's "you may" as it resolves (CR 603.5): `player` chooses whether `resume` happens. */
  | { kind: "askOptional"; player: PlayerId; resume: WorkItem[] }
  /** Triggered abilities of one batch still to be put on the stack, then priority for `player` (CR 603.3b). */
  | { kind: "putTriggers"; batch: PendingTrigger[]; player: PlayerId };
