// Performing state-based actions (CR 704.3).

import type { CardDatabase } from "../cards/types.ts";
import { happen } from "../pipeline/happen.ts";
import type { ProposedEvent, SingleEvent } from "../pipeline/proposed.ts";
import { stateBasedActions } from "../rules/state-based-actions.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import type { Loss } from "../state/result.ts";
import type { StateBasedAction } from "../state/state-based-actions.ts";
import { playersLose } from "./game-end.ts";
import { andThen, type Progress } from "./progress.ts";

/**
 * One check (CR 704.3): every state-based action that applies is listed from the same state, then all are performed
 * together as one event. The caller repeats the check while `performed` is true. Either way, the records of drawing
 * from an empty library and of deathtouch damage are cleared: they only count until the next check (CR 704.5b, 704.5h).
 */
export function checkStateBasedActions(
  state: GameState,
  cards: CardDatabase,
  kept: readonly ObjectId[] = [],
): Progress & { performed: boolean } {
  const actions = stateBasedActions(state, cards, kept);
  const cleared = clearDeathtouchDamage(clearEmptyLibraryDraws(state));
  if (actions.length === 0) return { state: cleared, events: [], performed: false };
  const progress = andThen({ state: cleared, events: [{ type: "STATE_BASED_ACTIONS", actions }] }, (s) =>
    happen(s, stateBasedActionsEvent(actions), cards),
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
    case "tokenOutsideBattlefield":
    case "copyOutsideStack":
    case "auraIllegallyAttached":
    case "equipmentIllegallyAttached":
    case "zeroToughness":
    case "lethalDamage":
    case "deathtouchDamage":
    case "plusAndMinusCounters":
    case "zeroLoyalty":
    case "legendRule":
      return null;
  }
}

/**
 * The state-based actions done to objects, as one event (CR 704.3). Cards that go to a graveyard together go in
 * battlefield order (D-039; later: CR 404.3 lets the owner choose).
 */
export function stateBasedActionsEvent(actions: readonly StateBasedAction[]): ProposedEvent {
  return { kind: "simultaneous", events: actions.flatMap(eventOn) };
}

/** What this state-based action does to an object, if anything. */
function eventOn(action: StateBasedAction): SingleEvent[] {
  switch (action.kind) {
    case "zeroLife":
    case "drewFromEmptyLibrary":
      return []; // players lose together, after the objects move
    case "tokenOutsideBattlefield":
    case "copyOutsideStack":
      return [{ kind: "ceaseToExist", object: action.object }];
    // It stays on the battlefield (CR 704.5n).
    case "equipmentIllegallyAttached":
      return [{ kind: "unattach", object: action.object }];
    // Put into its owner's graveyard, not destroyed (CR 704.5m).
    case "auraIllegallyAttached":
    case "zeroToughness":
    case "zeroLoyalty":
    case "legendRule":
      return [{ kind: "moveCard", object: action.object, to: { zone: "graveyard" } }]; // not "destroyed" (CR 704.5f)
    case "lethalDamage":
    case "deathtouchDamage":
      return [{ kind: "destroy", object: action.object }];
    case "plusAndMinusCounters": {
      const { object, count } = action;
      return [
        { kind: "removeCounters", object, counter: "+1/+1", amount: count },
        { kind: "removeCounters", object, counter: "-1/-1", amount: count },
      ];
    }
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

function clearDeathtouchDamage(state: GameState): GameState {
  return state.dealtDeathtouchDamage.length === 0 ? state : { ...state, dealtDeathtouchDamage: [] };
}
