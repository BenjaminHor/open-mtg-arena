// The current turn, for code that only runs once the game's first turn has begun, and the next player in turn order.

import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";
import type { Turn } from "../state/turn.ts";

/** The current turn. Throws before the first turn (during the start of the game), which would be an engine bug. */
export function currentTurn(state: GameState): Turn {
  if (state.turn === null) throw new Error("The game's first turn hasn't begun yet");
  return state.turn;
}

/** The next player in turn order (CR 103.1, 117.3d), wrapping around. */
export function nextPlayer(state: GameState, player: PlayerId): PlayerId {
  const at = state.turnOrder.indexOf(player);
  const next = state.turnOrder[(at + 1) % state.turnOrder.length];
  if (at < 0 || next === undefined) throw new Error(`${player} isn't in turn order`);
  return next;
}
