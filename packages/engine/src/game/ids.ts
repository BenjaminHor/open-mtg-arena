// Allocating ids and timestamps. Every new id comes from `GameState.nextId`, so ids are unique and the same
// game always gets the same ids.

import type { GameState } from "../state/game-state.ts";
import type { CardId, DecisionId, ObjectId } from "../state/ids.ts";

export function newObjectId(state: GameState): { id: ObjectId; state: GameState } {
  return { id: `o${state.nextId}`, state: { ...state, nextId: state.nextId + 1 } };
}

export function newCardId(state: GameState): { id: CardId; state: GameState } {
  return { id: `c${state.nextId}`, state: { ...state, nextId: state.nextId + 1 } };
}

export function newDecisionId(state: GameState): { id: DecisionId; state: GameState } {
  return { id: `d${state.nextId}`, state: { ...state, nextId: state.nextId + 1 } };
}

/** A new timestamp (CR 613.7). Objects that get one at the same time get them in a fixed order (CR 613.7m). */
export function newTimestamp(state: GameState): { timestamp: number; state: GameState } {
  return { timestamp: state.nextTimestamp, state: { ...state, nextTimestamp: state.nextTimestamp + 1 } };
}
