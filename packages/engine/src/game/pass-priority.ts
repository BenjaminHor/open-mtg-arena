// Passing priority (CR 117.3d, 117.4).

import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";
import { givePriority } from "./priority.ts";
import { andThen, type Progress } from "./progress.ts";
import { endStep, nextPlayer } from "./steps.ts";

/**
 * The player passes, and the next player in turn order gets priority (CR 117.3d). Once all players have passed in
 * succession, the top of the stack resolves, or if the stack is empty, the step ends (CR 117.4, 500.2).
 */
export function passPriority(state: GameState, player: PlayerId): Progress {
  const passes = state.passesInSuccession + 1;
  const passed: Progress = {
    state: { ...state, passesInSuccession: passes },
    events: [{ type: "PRIORITY_PASSED", player }],
  };
  if (passes < state.turnOrder.length) {
    return andThen(passed, (s) => givePriority(s, nextPlayer(state, player)));
  }
  // Resolving the top of the stack arrives with the stack itself in M1-07.
  if (state.zones.stack.length > 0) throw new Error("Resolving the stack isn't built yet (M1-07)");
  return andThen(passed, endStep);
}
