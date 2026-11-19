// Performing state-based actions (CR 704.3).

import type { CardDatabase } from "../cards/types.ts";
import { destroy } from "../permanents/destroy.ts";
import { stateBasedActions } from "../rules/state-based-actions.ts";
import type { GameState } from "../state/game-state.ts";
import type { Loss } from "../state/result.ts";
import type { StateBasedAction } from "../state/state-based-actions.ts";
import { moveCard } from "../zones/move-card.ts";
import { playersLose } from "./game-end.ts";
import { andThen, type Progress } from "./progress.ts";

/**
 * One check (CR 704.3): every state-based action that applies is listed from the same state, then all are performed
 * together as one event. The caller repeats the check while `performed` is true. Either way, the record of drawing
 * from an empty library is cleared: it only counts until the next check (CR 704.5b).
 */
export function checkStateBasedActions(state: GameState, cards: CardDatabase): Progress & { performed: boolean } {
  const actions = stateBasedActions(state, cards);
  const cleared = clearEmptyLibraryDraws(state);
  if (actions.length === 0) return { state: cleared, events: [], performed: false };
  let progress: Progress = { state: cleared, events: [{ type: "STATE_BASED_ACTIONS", actions }] };
  // Cards that go to a graveyard together go in battlefield order (D-039; CR 404.3 lets the owner choose).
  for (const action of actions) progress = andThen(progress, (s) => performOnObject(s, action));
  const losses = actions.flatMap((a): Loss[] =>
    a.kind === "zeroLife" || a.kind === "drewFromEmptyLibrary" ? [{ player: a.player, reason: a.kind }] : [],
  );
  // A player who loses for two reasons at once loses once, for the first reason listed.
  const once = losses.filter((l, i) => losses.findIndex((m) => m.player === l.player) === i);
  return { ...andThen(progress, (s) => playersLose(s, once)), performed: true };
}

function performOnObject(state: GameState, action: StateBasedAction): Progress {
  switch (action.kind) {
    case "zeroLife":
    case "drewFromEmptyLibrary":
      return { state, events: [] }; // players lose together, after the objects move
    case "zeroToughness":
      return moveCard(state, action.object, { zone: "graveyard" }); // not "destroyed" (CR 704.5f)
    case "lethalDamage":
      return destroy(state, action.object);
  }
}

function clearEmptyLibraryDraws(state: GameState): GameState {
  if (state.turnOrder.every((p) => state.players[p]?.attemptedDrawFromEmptyLibrary !== true)) return state;
  const players = { ...state.players };
  for (const p of state.turnOrder) {
    const ps = players[p];
    if (ps?.attemptedDrawFromEmptyLibrary) players[p] = { ...ps, attemptedDrawFromEmptyLibrary: false };
  }
  return { ...state, players };
}
