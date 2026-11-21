// Triggered abilities waiting to be put on the stack (CR 603.2, 603.3), and what an ability knows about the event that
// triggered it.

import type { TriggeredAbilityDef } from "../cards/triggers.ts";
import type { ObjectId, OracleId, PlayerId } from "./ids.ts";
import type { AbilityRef } from "./objects.ts";

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
  /** Which ability: one of the card's triggered abilities, or a delayed triggered ability with its text. */
  ref: TriggerRef;
  controller: PlayerId;
  event: TriggerEvent;
};

/** A triggered ability's reference: printed on its source's card, or delayed (CR 603.7). */
export type TriggerRef = Extract<AbilityRef, { kind: "triggered" | "delayed" }>;

/**
 * A delayed triggered ability waiting for its event (CR 603.7): "at the beginning of the next end step, sacrifice
 * this creature". Its source and controller are those of the ability that made it, as that ability resolved
 * (CR 603.7e). It triggers only once, the next time its event happens, then is gone (CR 603.7b).
 */
export type DelayedTrigger = {
  source: ObjectId;
  sourceOracleId: OracleId;
  controller: PlayerId;
  ability: TriggeredAbilityDef;
  /** The objects the effect that made it named, "that creature" in its text (CR 603.7c); left out when none. */
  objects?: ObjectId[];
};
