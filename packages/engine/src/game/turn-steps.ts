// The turn sequence, as data (CR 500.1, 501.1, 506.1, 512.1). One function walks it, so later rules can add or skip
// steps, phases and turns (CR 500.11; extra phases and steps, later: CR 500.8–500.10) in one place. Extra turns are in
// `extra-turns.ts`.

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

/**
 * In a two-player game the starting player skips the draw step of their first turn (CR 103.8a). The game's first turn
 * is always the starting player's. This depends on the kind of game, so `playerCount` is the players it started with,
 * not those still in it. Setup validation asks this too, so a fixed opening can't start in that step.
 */
export function skipsFirstDrawStep(turnNumber: number, playerCount: number): boolean {
  return turnNumber === 1 && playerCount === 2;
}

/** The step after this one in the turn, or null after cleanup. */
export function stepAfter(step: Step): Step | null {
  return TURN_STEPS[TURN_STEPS.indexOf(step) + 1] ?? null;
}
