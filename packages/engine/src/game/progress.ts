// What engine steps pass along: the new state and the events produced so far.

import type { GameEvent } from "../state/events.ts";
import type { GameState } from "../state/game-state.ts";

export type Progress = { state: GameState; events: GameEvent[] };

/** Runs one step after another, collecting their events. */
export function andThen(progress: Progress, step: (state: GameState) => Progress): Progress {
  const next = step(progress.state);
  return { state: next.state, events: [...progress.events, ...next.events] };
}
