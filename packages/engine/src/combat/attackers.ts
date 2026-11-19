// Who's attacking this combat (CR 508).

import type { GameState } from "../state/game-state.ts";

/**
 * Whether any creature was declared as an attacker this combat (CR 508.8), even if it has since left combat. When none
 * was, the declare blockers and combat damage steps are skipped. Creatures put onto the battlefield attacking will
 * count too, once something can do that.
 */
export function anyAttackers(state: GameState): boolean {
  return (state.combat?.attacks.length ?? 0) > 0;
}
