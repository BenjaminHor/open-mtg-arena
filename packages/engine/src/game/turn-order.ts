// Turn order (CR 103.1, 101.4).

import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";
import { currentTurn } from "./turn.ts";

/** The players in turn order starting with `first`, keeping their seating order (CR 103.1). */
export function rotateTo(seats: readonly PlayerId[], first: PlayerId): PlayerId[] {
  const at = seats.indexOf(first);
  if (at < 0) throw new Error(`${first} isn't a player`);
  return [...seats.slice(at), ...seats.slice(0, at)];
}

/** Every player in APNAP order: the active player first, then the others in turn order (CR 101.4). */
export function apnapOrder(state: GameState): PlayerId[] {
  return rotateTo(state.turnOrder, currentTurn(state).activePlayer);
}
