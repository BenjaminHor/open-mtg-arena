// Giving a player priority (CR 117). Every place that gives priority queues `givePriority`, so the checks that come
// first happen in one place: state-based actions (CR 117.5, 704.3), and later putting triggered abilities on the stack.

import type { CardDatabase } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";
import { waitFor } from "./decide.ts";
import type { Progress } from "./progress.ts";
import { checkStateBasedActions } from "./state-based-actions.ts";
import { queueWork } from "./work.ts";

/**
 * State-based actions are checked first (CR 117.5). If any were performed, the check repeats: `givePriority` is queued
 * again, rather than looped here, so a state-based action that needs a player's choice (the legend rule, CR 704.5j)
 * can wait for it. When none apply, the player gets priority. If the game ended, no one does.
 */
export function givePriority(state: GameState, player: PlayerId, cards: CardDatabase): Progress {
  const checked = checkStateBasedActions(state, cards);
  if (checked.state.result !== null) return { state: checked.state, events: checked.events };
  if (checked.performed) {
    return { state: queueWork(checked.state, { kind: "givePriority", player }), events: checked.events };
  }
  return { state: waitFor(checked.state, player, { kind: "priority" }), events: checked.events };
}
