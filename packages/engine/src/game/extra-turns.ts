// Extra turns (CR 500.7): "[a player] takes an extra turn after this one". Each is added directly after the current
// turn, so the most recently created is taken first; once none are left, the regular turn order goes on from the
// player whose regular turn was the most recent.

import type { GameEvent } from "../state/events.ts";
import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";
import type { Progress } from "./progress.ts";
import { currentTurn, nextPlayer } from "./turn.ts";

/**
 * Adds an extra turn for each player directly after the current turn, one at a time in the order given, which the
 * caller makes APNAP order (CR 500.7): the last added is taken first.
 */
export function addExtraTurns(state: GameState, players: readonly PlayerId[]): Progress {
  let extraTurns = state.extraTurns;
  const events: GameEvent[] = [];
  for (const player of players) {
    extraTurns = [player, ...extraTurns];
    events.push({ type: "EXTRA_TURN_ADDED", player });
  }
  return { state: { ...state, extraTurns }, events };
}

/**
 * Who takes the next turn, and whether it's an extra turn: the next extra turn if there is one, otherwise the player
 * after the most recent regular turn's player in turn order (CR 500.7, 103.1).
 */
export function nextTurn(state: GameState): { player: PlayerId; extra: boolean; state: GameState } {
  const [extra, ...rest] = state.extraTurns;
  if (extra !== undefined) return { player: extra, extra: true, state: { ...state, extraTurns: rest } };
  const from = state.regularTurnPlayer ?? currentTurn(state).activePlayer;
  return { player: nextPlayer(state, from), extra: false, state };
}
