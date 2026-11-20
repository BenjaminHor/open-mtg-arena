// Life totals changing (CR 119).

import type { Progress } from "../game/progress.ts";
import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";

/**
 * A player loses life (CR 119.3), from damage (CR 120.3a) or an effect. Reaching 0 life is a loss only when state-based
 * actions are next checked (CR 704.5a), not here.
 */
export function loseLife(state: GameState, player: PlayerId, amount: number): Progress {
  const ps = state.players[player];
  if (ps === undefined) throw new Error(`No player ${player}`);
  return {
    state: { ...state, players: { ...state.players, [player]: { ...ps, life: ps.life - amount } } },
    events: [{ type: "LIFE_LOST", player, amount }],
  };
}

/** A player gains life (CR 119.3). Gaining 0 isn't an event at all (CR 119.9); the pipeline drops it before this. */
export function gainLife(state: GameState, player: PlayerId, amount: number): Progress {
  const ps = state.players[player];
  if (ps === undefined) throw new Error(`No player ${player}`);
  return {
    state: { ...state, players: { ...state.players, [player]: { ...ps, life: ps.life + amount } } },
    events: [{ type: "LIFE_GAINED", player, amount }],
  };
}
