// The current turn, for code that only runs once the game's first turn has begun.

import type { GameState } from "../state/game-state.ts";
import type { Turn } from "../state/turn.ts";

/** The current turn. Throws before the first turn (during the start of the game), which would be an engine bug. */
export function currentTurn(state: GameState): Turn {
  if (state.turn === null) throw new Error("The game's first turn hasn't begun yet");
  return state.turn;
}
