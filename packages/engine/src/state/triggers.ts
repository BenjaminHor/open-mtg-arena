// Triggered abilities waiting to be put on the stack (CR 603.2, 603.3), and what an ability knows about the event that
// triggered it.

import type { ObjectId, OracleId, PlayerId } from "./ids.ts";

/**
 * What a triggered ability knows about the event that triggered it, for "that player" and "that creature" in its text.
 * Only public information: never a hidden card's id.
 */
export type TriggerEvent = {
  /** The player the event was about ("that player"): the one whose step began, who drew, who was dealt damage. */
  player: PlayerId | null;
  /** The object the event was about: the creature that entered. */
  object: ObjectId | null;
  /** How much, for "that much": the life gained (CR 119.3). */
  amount: number | null;
};

/**
 * A triggered ability that triggered and waits to be put on the stack the next time a player would receive priority
 * (CR 603.3). Everything is recorded as it triggers: its source may be gone by then, and its controller is whoever
 * controlled the source at that time (CR 603.3a).
 */
export type PendingTrigger = {
  source: ObjectId;
  sourceOracleId: OracleId;
  /** Which of the card's triggered abilities: an index into its definition's `triggers`. */
  index: number;
  controller: PlayerId;
  event: TriggerEvent;
};
