// Turn structure (CR 500–514).

import type { PlayerId } from "./ids.ts";

/**
 * Where the game is in the turn. Main phases have no steps (CR 505), so they appear here as their own entries.
 * Names follow the CR: beginning phase (CR 501), precombat main (CR 505.1), combat phase (CR 506),
 * postcombat main, ending phase (CR 512).
 */
export type Step =
  | "untap" // CR 502
  | "upkeep" // CR 503
  | "draw" // CR 504
  | "precombatMain" // CR 505
  | "beginningOfCombat" // CR 507
  | "declareAttackers" // CR 508
  | "declareBlockers" // CR 509
  | "combatDamage" // CR 510
  | "endOfCombat" // CR 511
  | "postcombatMain" // CR 505
  | "end" // CR 513
  | "cleanup"; // CR 514

export type Phase = "beginning" | "precombatMain" | "combat" | "postcombatMain" | "ending";

/** The phase a step belongs to (CR 500.1). */
export function phaseOf(step: Step): Phase {
  switch (step) {
    case "untap":
    case "upkeep":
    case "draw":
      return "beginning";
    case "precombatMain":
      return "precombatMain";
    case "beginningOfCombat":
    case "declareAttackers":
    case "declareBlockers":
    case "combatDamage":
    case "endOfCombat":
      return "combat";
    case "postcombatMain":
      return "postcombatMain";
    case "end":
    case "cleanup":
      return "ending";
  }
}

export type Turn = {
  /** 1 for the first turn of the game. */
  number: number;
  activePlayer: PlayerId;
  step: Step;
};
