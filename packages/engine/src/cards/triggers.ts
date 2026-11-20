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
  /** "Whenever another [filter] enters", relative to this permanent's controller (CR 603.6a). */
  | { kind: "anotherEnters"; filter: ObjectFilter }
  /** "At the beginning of [the/each player's] [step]" (CR 603.2b): every such step, whoever's turn it is. */
  | { kind: "beginningOfStep"; step: Step }
  /** "Whenever this creature attacks": declared as an attacker (CR 508.3a). */
  | { kind: "selfAttacks" };

/** An "intervening if" condition (CR 603.4), about the ability's source. */
export type TriggerCheck = { kind: "sourceUntapped" };
