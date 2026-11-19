// The turn sequence, as data (CR 500.1, 501.1, 506.1, 512.1). One function walks it, so later rules can add or skip
// steps, phases and turns (CR 500.7–500.11) in one place.

import type { Step } from "../state/turn.ts";

/** Every step and main phase of a turn, in order. */
export const TURN_STEPS: readonly Step[] = [
  "untap",
  "upkeep",
  "draw",
  "precombatMain",
  "beginningOfCombat",
  "declareAttackers",
  "declareBlockers",
  "combatDamage",
  "endOfCombat",
  "postcombatMain",
  "end",
  "cleanup",
];

/** The step after this one in the turn, or null after cleanup. */
export function stepAfter(step: Step): Step | null {
  return TURN_STEPS[TURN_STEPS.indexOf(step) + 1] ?? null;
}
