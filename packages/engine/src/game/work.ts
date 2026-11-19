// Adding work to the queue.

import type { GameState } from "../state/game-state.ts";
import type { WorkItem } from "../state/work.ts";

/**
 * Queues work to run next, ahead of anything already queued (D-032). Work that an item creates finishes before older
 * work continues. Queue a sequence in one call, in the order it should run: separate calls run last-queued first.
 */
export function queueWork(state: GameState, ...items: WorkItem[]): GameState {
  return { ...state, work: [...items, ...state.work] };
}
