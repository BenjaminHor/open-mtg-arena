// Players losing, and the game ending (CR 104).

import type { GameState } from "../state/game-state.ts";
import type { Loss } from "../state/result.ts";
import type { Progress } from "./progress.ts";

/**
 * These players lose the game at the same time (CR 104.3). If one player is left, they win (CR 104.2a); if none, the
 * game is a draw (CR 104.4a). Either way the game ends at once (CR 104.1): nothing is pending or queued after it, and a
 * spell or ability part way through being put on the stack stays where it is. (When a player leaves a multiplayer game
 * that goes on, the objects they own leave too, later: CR 800.4a.)
 */
export function playersLose(state: GameState, losses: readonly Loss[]): Progress {
  if (losses.length === 0) return { state, events: [] };
  const losers = losses.map((l) => l.player);
  const left = state.turnOrder.filter((p) => !losers.includes(p));
  if (left.length > 1) {
    // In a multiplayer game the loser leaves and the game goes on (later: CR 800.4). Not supported yet
    // (future-rules.md).
    throw new Error("A player lost with more than one player left: leaving a multiplayer game isn't supported yet");
  }
  // Before the first turn (a concession during mulligans) the turn is 0.
  const result = { winner: left[0] ?? null, losses: [...losses], turn: state.turn?.number ?? 0 };
  return {
    state: { ...state, result, pending: null, work: [], casting: null, combat: null },
    events: [
      ...losses.map((l) => ({ type: "PLAYER_LOST", player: l.player, reason: l.reason }) as const),
      { type: "GAME_ENDED", result },
    ],
  };
}
