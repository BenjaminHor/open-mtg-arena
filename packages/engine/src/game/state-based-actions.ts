// Performing state-based actions (CR 704.3).

import type { CardDatabase } from "../cards/types.ts";
import { happen } from "../pipeline/happen.ts";
import type { ProposedEvent } from "../pipeline/proposed.ts";
import { stateBasedActions } from "../rules/state-based-actions.ts";
import type { GameState } from "../state/game-state.ts";
import type { Loss } from "../state/result.ts";
import type { StateBasedAction } from "../state/state-based-actions.ts";
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
  // Cards that go to a graveyard together go in battlefield order (D-039; later: CR 404.3 lets the owner choose).
  const events = actions.flatMap(eventOn);
  const progress = andThen({ state: cleared, events: [{ type: "STATE_BASED_ACTIONS", actions }] }, (s) =>
    happen(s, { kind: "simultaneous", events }, cards),
  );
  const losses = actions.flatMap((a): Loss[] => {
    const loss = lossFrom(a);
    return loss === null ? [] : [loss];
  });
  // A player who loses for two reasons at once loses once, for the first reason listed.
  const once = losses.filter((l, i) => losses.findIndex((m) => m.player === l.player) === i);
  return { ...andThen(progress, (s) => playersLose(s, once)), performed: true };
}

/** Whether this state-based action makes a player lose, and why (CR 104.3). Exhaustive, so a new one must say. */
function lossFrom(action: StateBasedAction): Loss | null {
  switch (action.kind) {
    case "zeroLife":
    case "drewFromEmptyLibrary":
      return { player: action.player, reason: action.kind };
    case "zeroToughness":
    case "lethalDamage":
      return null;
  }
}

/** What this state-based action does to an object, if anything. */
function eventOn(action: StateBasedAction): ProposedEvent[] {
  switch (action.kind) {
    case "zeroLife":
    case "drewFromEmptyLibrary":
      return []; // players lose together, after the objects move
    case "zeroToughness":
      return [{ kind: "moveCard", object: action.object, to: { zone: "graveyard" } }]; // not "destroyed" (CR 704.5f)
    case "lethalDamage":
      return [{ kind: "destroy", object: action.object }];
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
