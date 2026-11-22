// What a resolving spell or ability did "this way" (CR 608.2c): the cards found, exiled, sacrificed, the Aura hosts
// chosen, the name chosen, kept in `GameState.resolution` for the effects after it.

import type { GameState, Resolution } from "../state/game-state.ts";

/**
 * Keeps a "this way" result for the rest of this resolution (CR 608.2c). Bookkeeping, not an event: the events that
 * did it already went through the pipeline. Only a resolving spell or ability has one (pipeline/README.md).
 */
export function remember(state: GameState, result: Partial<Omit<Resolution, "object">>): GameState {
  if (state.resolution === null) throw new Error('a "this way" result outside a resolution');
  return { ...state, resolution: { ...state.resolution, ...result } };
}
