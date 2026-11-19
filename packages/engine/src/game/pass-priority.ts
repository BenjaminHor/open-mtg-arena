// Passing priority (CR 117.3d, 117.4).

import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";
import type { Progress } from "./progress.ts";
import { nextPlayer } from "./steps.ts";
import { queueWork } from "./work.ts";

/**
 * The player passes, and the next player in turn order receives priority (CR 117.3d). Once all players have passed in
 * succession, the top of the stack resolves, or if the stack is empty, the step ends (CR 117.4, 405.5, 500.2).
 */
export function passPriority(state: GameState, player: PlayerId): Progress {
  const passes = state.passesInSuccession + 1;
  const passed: GameState = { ...state, passesInSuccession: passes };
  const events = [{ type: "PRIORITY_PASSED", player } as const];
  if (passes < state.turnOrder.length) {
    return { state: queueWork(passed, { kind: "givePriority", player: nextPlayer(state, player) }), events };
  }
  const next = state.zones.stack.length > 0 ? ({ kind: "resolveTopOfStack" } as const) : ({ kind: "endStep" } as const);
  return { state: queueWork(passed, next), events };
}
