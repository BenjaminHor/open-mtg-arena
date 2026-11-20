// How many times this turn each object's printed activated ability has become activated (D-078), for "if this ability
// has been activated four or more times this turn" (Dragon Whelp). Counted as the ability becomes activated (CR 602.2b),
// so a cancelled activation, reversed (CR 734.1), never counts, and a countered one still does. Per object: a permanent
// that leaves and returns is a new object with a count of 0 (CR 400.7). Emptied as each turn begins.

import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";

/** Counts one more activation of the object's printed ability `index`. */
export function countActivation(state: GameState, object: ObjectId, index: number): GameState {
  const others = state.turnHistory.activations.filter((a) => !(a.object === object && a.index === index));
  const count = activationsThisTurn(state, object, index) + 1;
  return { ...state, turnHistory: { ...state.turnHistory, activations: [...others, { object, index, count }] } };
}

/** How many times this turn the object's printed ability `index` has become activated. */
export function activationsThisTurn(state: GameState, object: ObjectId, index: number): number {
  return state.turnHistory.activations.find((a) => a.object === object && a.index === index)?.count ?? 0;
}
