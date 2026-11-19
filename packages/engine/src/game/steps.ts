// Walking the turn: ending a step, beginning the next, and beginning turns (CR 500–514). This is the one place the
// game moves between steps, so effects that last "until end of step", skipped and extra steps, and "at the beginning
// of" triggers have one place to hook in. The work queue drives it (D-032).

import type { CardDatabase } from "../cards/types.ts";
import { anyAttackers } from "../combat/attackers.ts";
import { endUntilEndOfTurnEffects } from "../effects/continuous-effect.ts";
import { removeAllDamage } from "../permanents/damage.ts";
import { untapPermanents } from "../permanents/untap.ts";
import { controllerOf } from "../rules/controller.ts";
import type { GameEvent } from "../state/events.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { emptyManaPool, MANA_TYPES } from "../state/mana.ts";
import type { Step } from "../state/turn.ts";
import { discardCards } from "../zones/discard.ts";
import { drawCard } from "../zones/draw.ts";
import { zoneList } from "../zones/zone-list.ts";
import { waitFor } from "./decide.ts";
import { andThen, type Progress } from "./progress.ts";
import { checkStateBasedActions } from "./state-based-actions.ts";
import { currentTurn } from "./turn.ts";
import { skipsFirstDrawStep, stepAfter } from "./turn-steps.ts";
import { queueWork } from "./work.ts";

/** The maximum hand size (CR 402.2). A different rule from the starting hand size, though both are normally seven. */
export const MAXIMUM_HAND_SIZE = 7;

/** Begins a player's turn with its untap step (CR 501.1). Each player's land count starts again (CR 305.2). */
export function beginTurn(state: GameState, player: PlayerId, number: number): Progress {
  const players = { ...state.players };
  for (const p of state.turnOrder) {
    const ps = players[p];
    if (ps !== undefined) players[p] = { ...ps, landsPlayedThisTurn: 0 };
  }
  // The active player's permanents have now been under their control since their most recent turn began (CR 302.6).
  // This belongs to the turn beginning, not the untap step, so it still happens if the untap step is skipped.
  const objects = { ...state.objects };
  for (const id of state.zones.battlefield) {
    const obj = objects[id];
    if (obj?.kind === "card" && controllerOf(state, id) === player)
      objects[id] = { ...obj, controlledSinceTurnStart: true };
  }
  const begun: GameState = { ...state, players, objects, turn: { number, activePlayer: player, step: "untap" } };
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

/**
 * The cleanup step's first turn-based action (CR 514.1). If the active player's hand is over their maximum hand size,
 * they choose that many cards to discard, one decision per card (`chosen` collects them), and then discard them all at
 * once: it's one action. Then the rest of the step.
 */
export function finishCleanup(state: GameState, chosen: readonly ObjectId[] = []): Progress {
  const turn = currentTurn(state);
  const hand = zoneList(state, { zone: "hand", player: turn.activePlayer });
  const excess = hand.length - MAXIMUM_HAND_SIZE;
  if (chosen.length < excess) {
    const remaining = excess - chosen.length;
    return {
      state: waitFor(state, turn.activePlayer, { kind: "discardToHandSize", remaining, chosen: [...chosen] }),
      events: [],
    };
  }
  // CR 514.1 happens once per cleanup step, so after the discard the step moves on even if something left the hand
  // over its maximum; a new cleanup step would deal with that (CR 514.3a).
  if (chosen.length > 0) return andThen(discardCards(state, chosen), endCleanup);
  return endCleanup(state);
}

/**
 * CR 514.2: damage is removed, and "until end of turn" and "this turn" effects end, all as one action, in one call, so
 * no state-based action check can come between them. Normally no one gets priority and the step ends (CR 514.3). But
 * if the check that follows performs any state-based actions, the active player gets priority, and once all players
 * pass with the stack empty, another cleanup step begins (CR 514.3a, `passPriority`).
 */
function endCleanup(state: GameState): Progress {
  const removed = andThen(removeAllDamage(state), endUntilEndOfTurnEffects);
  return { state: queueWork(removed.state, { kind: "cleanupStateBasedActions" }), events: removed.events };
}

/**
 * The cleanup step's state-based action check (CR 514.3a), after the CR 514.2 action. If none were performed, the step
 * ends with no one getting priority (CR 514.3); if any were, the active player gets priority (which checks again).
 */
export function cleanupStateBasedActions(state: GameState, cards: CardDatabase): Progress {
  const checked = checkStateBasedActions(state, cards);
  if (checked.state.result !== null) return checked;
  const active = currentTurn(checked.state).activePlayer;
  const next = checked.performed ? ({ kind: "givePriority", player: active } as const) : ({ kind: "endStep" } as const);
  return { state: queueWork(checked.state, next), events: checked.events };
}

/** Another cleanup step begins (CR 514.3a), after the last one gave players priority and they all passed. */
export function anotherCleanupStep(state: GameState): Progress {
  return andThen(emptyManaPools(state), (s) => beginStep(s, "cleanup"));
}

/**
 * A skipped step is passed over as though it didn't exist (CR 500.11, 614.10a): it doesn't begin, and nothing in it
 * happens.
 */
function isSkipped(state: GameState, step: Step): boolean {
  const turn = currentTurn(state);
  switch (step) {
    case "draw":
      return skipsFirstDrawStep(turn.number, state.setup.players.length);
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
      return andThen(andThen(progress, untapStep), (s) => ({ state: queueWork(s, { kind: "endStep" }), events: [] }));
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

/** The active player untaps all their permanents at once (CR 502.3). */
function untapStep(state: GameState): Progress {
  const active = currentTurn(state).activePlayer;
  return untapPermanents(
    state,
    state.zones.battlefield.filter((id) => controllerOf(state, id) === active),
  );
}

function priorityForActivePlayer(state: GameState): Progress {
  return { state: queueWork(state, { kind: "givePriority", player: currentTurn(state).activePlayer }), events: [] };
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

/** The next player in turn order (CR 103.1, 117.3d), wrapping around. */
export function nextPlayer(state: GameState, player: PlayerId): PlayerId {
  const at = state.turnOrder.indexOf(player);
  const next = state.turnOrder[(at + 1) % state.turnOrder.length];
  if (at < 0 || next === undefined) throw new Error(`${player} isn't in turn order`);
  return next;
}
