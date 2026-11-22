// Adding work to the queue.

import type { AsEntersAnswer } from "../state/decisions.ts";
import type { GameState } from "../state/game-state.ts";
import type { ReplacementChoice } from "../state/replacements.ts";
import type { WorkItem } from "../state/work.ts";

/**
 * Queues work to run next, ahead of anything already queued (D-032). Work that an item creates finishes before older
 * work continues. Queue a sequence in one call, in the order it should run: separate calls run last-queued first.
 */
export function queueWork(state: GameState, ...items: WorkItem[]): GameState {
  return { ...state, work: [...items, ...state.work] };
}

/**
 * The event that waited for a choice as a permanent enters (CR 614.12a), queued to be replaced again from the start with
 * the choice kept with the others.
 */
export function resumeAsEnters(state: GameState, answering: AsEntersAnswer, choice: ReplacementChoice): GameState {
  const { proposed, choices } = answering.resume;
  return queueWork(state, { kind: "resumeEvent", proposed, choices: [...choices, choice] });
}
