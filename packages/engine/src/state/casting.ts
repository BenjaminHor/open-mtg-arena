// A spell being cast (CR 601.2) or an ability being activated (CR 602.2b, which follows the same steps), kept in state
// so every pause in the procedure is plain data, and so the whole action can be reversed if the player cancels
// (CR 734.1, D-035).

import type { ObjectId, PlayerId } from "./ids.ts";
import type { ManaPool } from "./mana.ts";
import type { CardObject } from "./objects.ts";
import type { PendingTrigger } from "./triggers.ts";

export type Casting = {
  player: PlayerId;
  /** The spell or ability on the stack. */
  object: ObjectId;
  /** Where it came from, to reverse it exactly (CR 734.1). */
  origin: CastingOrigin;
  /** The player's pool before, restored if it's reversed. */
  poolBefore: ManaPool;
  /** Permanents tapped for mana during this cast or activation, which untap if it's reversed (CR 734.1). */
  tappedForMana: ObjectId[];
  /**
   * How many targets each instance of "target" takes, so far: announced by the player when the number varies, the
   * text's number otherwise (CR 601.2c).
   */
  targetCounts: number[];
  /** The permanents chosen so far to sacrifice for the cost, one per sacrifice it calls for, sacrificed as it's paid. */
  sacrifices: ObjectId[];
  /**
   * The triggered abilities waiting as it began: none from priority (CR 117.5), but a cast during a resolution
   * (CR 608.2g) may begin with some, which a cancel keeps (CR 734.1 reverses only the cast).
   */
  triggersBefore: PendingTrigger[];
  /**
   * Each library's top card as it began: a new top card isn't revealed until the spell becomes cast (CR 401.5).
   */
  libraryTops: Record<PlayerId, ObjectId | null>;
};

export type CastingOrigin =
  /** A spell cast from hand: the card as it was, and where it was in the hand. */
  | { kind: "card"; card: CardObject; handIndex: number }
  /**
   * A spell cast while a spell or ability resolves (CR 608.2g), without paying its mana cost (Djinn of Wishes): from
   * the top of `library`, put back there if it's cancelled (CR 734.1). No player receives priority after it's cast.
   */
  | { kind: "resolution"; card: CardObject; library: PlayerId }
  /** An activated ability of a permanent (CR 602.2a): it was created on the stack, and simply ceases to exist. */
  | { kind: "ability"; source: ObjectId }
  /**
   * A triggered ability being put on the stack, its targets chosen as it goes on (CR 603.3d): no cost and no cancel.
   * `batch` is the rest of its batch still to go on, and `priorityTo` who gets priority after (CR 603.3b).
   */
  | { kind: "trigger"; batch: PendingTrigger[]; priorityTo: PlayerId };
