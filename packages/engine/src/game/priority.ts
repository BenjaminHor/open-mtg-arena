// Giving a player priority (CR 117). Every place that gives priority queues `givePriority`, so the checks that come
// first happen in one place: state-based actions (CR 117.5, 704.3), then putting triggered abilities on the stack
// (CR 603.3).

import type { CardDatabase } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";
import { startPuttingTriggers } from "../triggers/put-on-stack.ts";
import { waitFor } from "./decide.ts";
import type { Progress } from "./progress.ts";
import { checkStateBasedActions } from "./state-based-actions.ts";
import { queueWork } from "./work.ts";

/**
 * State-based actions are checked first (CR 117.5). If any were performed, the check repeats: `givePriority` is queued
 * again, rather than looped here, so a state-based action that needs a player's choice (the legend rule,
 * later: CR 704.5j) can wait for it. When none apply, the player gets priority. If the game ended, no one does.
 */
export function givePriority(state: GameState, player: PlayerId, cards: CardDatabase): Progress {
  const checked = checkStateBasedActions(state, cards);
  if (checked.state.result !== null) return { state: checked.state, events: checked.events };
  if (checked.performed) {
    return { state: queueWork(checked.state, { kind: "givePriority", player }), events: checked.events };
  }
  // Then triggered abilities go on the stack, and priority is given again, checking both again (CR 117.5, 603.3b).
  if (checked.state.pendingTriggers.length > 0) {
    return { state: startPuttingTriggers(checked.state, player), events: checked.events };
  }
  // With nothing on the stack or waiting to go on it, nothing can need a gone object's last known information.
  const settled = checked.state.zones.stack.length === 0 ? { ...checked.state, lastKnown: {} } : checked.state;
  return { state: waitFor(settled, player, { kind: "priority" }), events: checked.events };
}
