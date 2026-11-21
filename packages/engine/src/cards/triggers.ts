// Triggered abilities as card data (CR 603, D-076): what each triggers on, its "intervening if", and what it does.
// Interpreted by engine/src/triggers/ (detecting, putting on the stack) and game/resolve.ts.

import type { Step } from "../state/turn.ts";
import type { Effect, ObjectFilter, TargetSpec } from "./types.ts";

/**
 * "When/whenever/at [condition], [effect]" (CR 603.1). Its targets are chosen as it's put on the stack (CR 603.3d), and
 * "you may" is asked as it resolves (CR 603.5).
 */
export type TriggeredAbilityDef = {
  when: TriggerCondition;
  /** "If [condition]" right after the trigger condition: checked as it triggers and again as it resolves (CR 603.4). */
  onlyIf?: TriggerCheck;
  /** "You may [effects]": the controller chooses as it resolves whether to do them (CR 603.5). */
  optional?: true;
  targets: TargetSpec[];
  effects: Effect[];
};

/** What a triggered ability triggers on (CR 603.2): an event, matched as it happens. */
export type TriggerCondition =
  /** "When this creature enters" (CR 603.6a). */
  | { kind: "selfEnters" }
  /**
   * "When this creature dies": put into a graveyard from the battlefield (CR 700.4). A leaves-the-battlefield ability,
   * so it looks back in time: it triggers from the creature as it last existed there (CR 603.6c, 603.10a).
   */
  | { kind: "selfDies" }
  /** "Whenever another [filter] enters", relative to this permanent's controller (CR 603.6a). */
  | { kind: "anotherEnters"; filter: ObjectFilter }
  /**
   * "At the beginning of [the / each player's / your] [step]" (CR 603.2b): `each`, every such step, whoever's turn it
   * is ("the end step" too); `yours`, only in turns of the trigger's controller; `attachedController`, "the upkeep of
   * enchanted creature's controller" (Soul Bleed), in turns of whoever controls what this is attached to then.
   */
  | { kind: "beginningOfStep"; step: Step; whose: "each" | "yours" | "attachedController" }
  /** "Whenever this creature attacks": declared as an attacker (CR 508.3a). */
  | { kind: "selfAttacks" }
  /**
   * "Whenever [a player / you / an opponent] casts a [filter] spell": as the spell becomes cast (CR 601.2i), matched
   * against it on the stack. The filter's `controller` is the caster, relative to this ability's controller. A spell
   * put onto the stack or the battlefield without being cast doesn't trigger it.
   */
  | { kind: "spellCast"; filter: ObjectFilter }
  /** "Whenever a +1/+1 counter is removed from this creature": once for each counter removed (CR 603.2c, its ruling). */
  | { kind: "selfCountersRemoved"; counter: string }
  /** "Whenever [a player / you / an opponent] draws a card": each card drawn (CR 121.1, 603.2c). */
  | { kind: "playerDraws"; player: PlayerRelation }
  /** "Whenever [a player / you / an opponent] discards a card": each card discarded (CR 701.9a, 603.2c). */
  | { kind: "playerDiscards"; player: PlayerRelation }
  /**
   * "Whenever a player taps a land for mana": each time a land's mana ability with {T} in its cost resolves and produces
   * mana (CR 106.12, 106.12a). "That player" is who activated it.
   */
  | { kind: "landTappedForMana" }
  /**
   * "Whenever this creature deals [combat] damage to [a player / an opponent]": each damage event from it to such a
   * player (CR 120.2, 510.2). "That player" is the player dealt damage.
   */
  | { kind: "selfDealsDamageToPlayer"; player: PlayerRelation; combatOnly: boolean }
  /**
   * "Whenever this creature blocks or becomes blocked by a creature": once for each creature it blocks and each
   * creature blocking it, as blockers are declared (CR 509.3b, 509.3d). "That creature" is the other one.
   */
  | { kind: "selfBlocksOrBlocked" }
  /**
   * "Whenever this creature blocks a creature": once for each attacking creature it blocks, as blockers are declared
   * (CR 509.3b). "That creature" is the one it blocks.
   */
  | { kind: "selfBlocks" }
  /**
   * "When this creature becomes the target of a spell or ability": as the target is chosen (CR 601.2c), for a spell, an
   * activated ability or a triggered ability (CR 603.3d).
   */
  | { kind: "selfBecomesTarget" }
  /**
   * "When enchanted creature becomes the target of a spell or ability" (Ice Cage): what this is attached to, as the
   * target is chosen (CR 601.2c, 603.3d).
   */
  | { kind: "attachedBecomesTarget" }
  /**
   * "Whenever [you / a player] gain life": once per life-gain event, whatever the amount (CR 119.9; each lifelink source
   * is its own event). "That much" is the amount gained.
   */
  | { kind: "playerGainsLife"; player: PlayerRelation };

/**
 * Which players an event about a player counts for, relative to the ability's controller: anyone, "you", or "an
 * opponent" (CR 102.2; later: CR 102.3 for teams).
 */
export type PlayerRelation = "anyPlayer" | "you" | "opponent";

/** An "intervening if" condition (CR 603.4), about the ability's source. */
export type TriggerCheck = { kind: "sourceUntapped" };
