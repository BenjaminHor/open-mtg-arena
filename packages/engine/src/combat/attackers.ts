// Who's attacking this combat (CR 508).

import type { GameState } from "../state/game-state.ts";

/**
 * Whether any creature was declared as an attacker or put onto the battlefield attacking this combat. Declaring
 * attackers arrives in M1-13; until then no creature ever attacks, so the declare blockers and combat damage steps
 * are always skipped (CR 508.8).
 */
export function anyAttackers(_state: GameState): boolean {
  return false;
}
