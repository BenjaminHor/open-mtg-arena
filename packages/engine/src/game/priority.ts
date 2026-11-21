// Giving a player priority (CR 117). Every place that gives priority queues `givePriority`, so the checks that come
// first happen in one place: state-based actions (CR 117.5, 704.3), then putting triggered abilities on the stack
// (CR 603.3).

import type { CardDatabase } from "../cards/types.ts";
import { controllerOf } from "../rules/controller.ts";
import { legendRuleGroups } from "../rules/legend-rule.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { startPuttingTriggers } from "../triggers/put-on-stack.ts";
import { waitFor } from "./decide.ts";
import type { Progress } from "./progress.ts";
import { checkStateBasedActions } from "./state-based-actions.ts";
import { apnapOrder } from "./turn-order.ts";
import { queueWork } from "./work.ts";

/**
 * State-based actions are checked first (CR 117.5). If any were performed, the check repeats: `givePriority` is queued
 * again, rather than looped here, so a state-based action that needs a player's choice (the legend rule, CR 704.5j)
 * can wait for it: that choice is asked first, and the check is made once it's answered. When none apply, the player gets priority. If the game ended, no one does.
 */
export function givePriority(state: GameState, player: PlayerId, cards: CardDatabase): Progress {
  // The legend rule needs a choice, made before the check performs it with the others (CR 704.5j, 704.3).
  const legend = askToKeepLegend(state, [], player, cards);
  if (legend !== null) return { state: legend, events: [] };
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
  const settled =
    checked.state.zones.stack.length === 0
      ? { ...checked.state, lastKnown: {}, lastKnownCharacteristics: {} }
      : checked.state;
  return { state: waitFor(settled, player, { kind: "priority" }), events: checked.events };
}

/**
 * The next set of same-named legendary permanents a player controls with no choice yet, asked of that player, the
 * active player's first (CR 704.5j, 101.4); null when every set has a permanent chosen in `kept`.
 */
export function askToKeepLegend(
  state: GameState,
  kept: readonly ObjectId[],
  priorityTo: PlayerId,
  cards: CardDatabase,
): GameState | null {
  const order = apnapOrder(state);
  const open = legendRuleGroups(state, cards)
    .filter((group) => !group.some((id) => kept.includes(id)))
    .map((group) => ({ group, controller: controllerOf(state, group[0] as ObjectId, cards) }))
    .sort((a, b) => order.indexOf(a.controller) - order.indexOf(b.controller));
  const next = open[0];
  if (next === undefined) return null;
  return waitFor(state, next.controller, { kind: "keepLegend", options: next.group, kept: [...kept], priorityTo });
}

/**
 * A player chose which legendary permanent to keep. Once every set is chosen for, the state-based actions are checked
 * with those choices, all together (CR 704.3), and priority is given as usual, checking again.
 */
export function answerKeepLegend(
  state: GameState,
  kept: readonly ObjectId[],
  priorityTo: PlayerId,
  cards: CardDatabase,
): Progress {
  const more = askToKeepLegend(state, kept, priorityTo, cards);
  if (more !== null) return { state: more, events: [] };
  const checked = checkStateBasedActions(state, cards, kept);
  if (checked.state.result !== null) return { state: checked.state, events: checked.events };
  return { state: queueWork(checked.state, { kind: "givePriority", player: priorityTo }), events: checked.events };
}
