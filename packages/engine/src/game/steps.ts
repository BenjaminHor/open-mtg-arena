// Walking the turn: ending a step, beginning the next, and beginning turns (CR 500–514). This is the one place the
// game moves between steps, so effects that last "until end of step", skipped and extra steps, and "at the beginning
// of" triggers have one place to hook in. M1-07's work queue will drive it.

import { anyAttackers } from "../combat/attackers.ts";
import { removeAllDamage } from "../permanents/damage.ts";
import { untapPermanent } from "../permanents/untap.ts";
import { controllerOf } from "../rules/controller.ts";
import type { GameEvent } from "../state/events.ts";
import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";
import { emptyManaPool, MANA_TYPES } from "../state/mana.ts";
import type { Step } from "../state/turn.ts";
import { drawCard } from "../zones/draw.ts";
import { zoneList } from "../zones/zone-list.ts";
import { waitFor } from "./decide.ts";
import { givePriority } from "./priority.ts";
import { andThen, type Progress } from "./progress.ts";
import { currentTurn } from "./turn.ts";
import { stepAfter } from "./turn-steps.ts";

/** The maximum hand size (CR 402.2). A different rule from the starting hand size, though both are normally seven. */
export const MAXIMUM_HAND_SIZE = 7;

/** Begins a player's turn with its untap step (CR 500.1). Each player's land count starts again (CR 305.2). */
export function beginTurn(state: GameState, player: PlayerId, number: number): Progress {
  const players = { ...state.players };
  for (const p of state.turnOrder) {
    const ps = players[p];
    if (ps !== undefined) players[p] = { ...ps, landsPlayedThisTurn: 0 };
  }
  const begun: GameState = { ...state, players, turn: { number, activePlayer: player, step: "untap" } };
  return andThen({ state: begun, events: [{ type: "TURN_BEGAN", turn: number, activePlayer: player }] }, (s) =>
    beginStep(s, "untap"),
  );
}

/**
 * Ends the current step (CR 500.5: unspent mana empties) and begins the next step that isn't skipped. After cleanup,
 * the next player in turn order begins their turn.
 */
export function endStep(state: GameState): Progress {
  const turn = currentTurn(state);
  const emptied = emptyManaPools(state);
  let next = stepAfter(turn.step);
  while (next !== null && isSkipped(emptied.state, next)) next = stepAfter(next);
  if (next !== null) return andThen(emptied, (s) => beginStep(s, next));
  const after = nextPlayer(state, turn.activePlayer);
  return andThen(emptied, (s) => beginTurn(s, after, turn.number + 1));
}

/** Finishes the cleanup step once the active player has discarded down to their maximum hand size (CR 514.1). */
export function finishCleanup(state: GameState): Progress {
  const turn = currentTurn(state);
  const hand = zoneList(state, { zone: "hand", player: turn.activePlayer });
  if (hand.length > MAXIMUM_HAND_SIZE) {
    const remaining = hand.length - MAXIMUM_HAND_SIZE;
    return { state: waitFor(state, turn.activePlayer, { kind: "discardToHandSize", remaining }), events: [] };
  }
  // CR 514.2, then no one gets priority (CR 514.3): with no state-based actions or triggers yet (CR 514.3a), the step
  // simply ends.
  return andThen(removeAllDamage(state), endStep);
}

/**
 * A skipped step is passed over as though it didn't exist (CR 500.11, 614.10a): it doesn't begin, and nothing in it
 * happens.
 */
function isSkipped(state: GameState, step: Step): boolean {
  const turn = currentTurn(state);
  switch (step) {
    case "draw":
      // In a two-player game the starting player skips the draw step of their first turn (CR 103.8a). The first turn of
      // the game is always the starting player's.
      return turn.number === 1 && state.turnOrder.length === 2;
    case "declareBlockers":
    case "combatDamage":
      return !anyAttackers(state); // CR 508.8
    default:
      return false;
  }
}

/** Begins a step: its turn-based actions, then priority for the active player, if anyone gets priority in it. */
function beginStep(state: GameState, step: Step): Progress {
  const turn = currentTurn(state);
  const started: GameState = { ...state, turn: { ...turn, step }, passesInSuccession: 0 };
  const progress: Progress = {
    state: started,
    events: [{ type: "STEP_BEGAN", turn: turn.number, step, activePlayer: turn.activePlayer }],
  };
  switch (step) {
    case "untap":
      // CR 502.3, then no one gets priority (CR 502.4) and the step ends.
      return andThen(andThen(progress, untapStep), endStep);
    case "draw":
      // CR 504.1, then priority (CR 504.2).
      return andThen(
        andThen(progress, (s) => drawCard(s, turn.activePlayer)),
        priorityForActivePlayer,
      );
    case "cleanup":
      return andThen(progress, finishCleanup);
    case "upkeep":
    case "precombatMain":
    case "beginningOfCombat":
    case "declareAttackers":
    case "declareBlockers":
    case "combatDamage":
    case "endOfCombat":
    case "postcombatMain":
    case "end":
      // These have no turn-based actions yet (declaring attackers and blockers and combat damage arrive in M1-13).
      return andThen(progress, priorityForActivePlayer);
  }
}

/**
 * The active player untaps their permanents (CR 502.3). Those permanents have now been under their control since the
 * turn began (CR 302.6).
 */
function untapStep(state: GameState): Progress {
  const active = currentTurn(state).activePlayer;
  let progress: Progress = { state, events: [] };
  for (const id of state.zones.battlefield) {
    if (controllerOf(state, id) !== active) continue;
    progress = andThen(progress, (s) => untapPermanent(s, id));
    const obj = progress.state.objects[id];
    if (obj?.kind === "card") {
      progress = {
        state: {
          ...progress.state,
          objects: { ...progress.state.objects, [id]: { ...obj, controlledSinceTurnStart: true } },
        },
        events: progress.events,
      };
    }
  }
  return progress;
}

function priorityForActivePlayer(state: GameState): Progress {
  return { state: givePriority(state, currentTurn(state).activePlayer), events: [] };
}

/** Empties every player's mana pool (CR 500.5), reporting only the pools that had mana. */
function emptyManaPools(state: GameState): Progress {
  const players = { ...state.players };
  const events: GameEvent[] = [];
  for (const p of state.turnOrder) {
    const ps = players[p];
    if (ps === undefined || MANA_TYPES.every((t) => ps.manaPool[t] === 0)) continue;
    events.push({ type: "MANA_EMPTIED", player: p, lost: ps.manaPool });
    players[p] = { ...ps, manaPool: emptyManaPool() };
  }
  return { state: { ...state, players }, events };
}

/** The next player in turn order (CR 101.4), wrapping around. */
export function nextPlayer(state: GameState, player: PlayerId): PlayerId {
  const at = state.turnOrder.indexOf(player);
  const next = state.turnOrder[(at + 1) % state.turnOrder.length];
  if (at < 0 || next === undefined) throw new Error(`${player} isn't in turn order`);
  return next;
}
