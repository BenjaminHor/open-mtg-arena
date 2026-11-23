// The host's loop (architecture.md, "Match host"). `advance` takes every action the host may take on its own (an agent
// seat's choice, a decision with one legal answer, auto-pass and auto-tap), and `advanceOne` takes one. It stops when a
// person must decide (or the game is over), and the UI shows that decision. `submit` applies the person's action. All
// are pure: a match in, a new match out; every action is logged, so the log replays the match exactly.

import { chooseAction, heuristicAction } from "@mtg/ai";
import {
  type Action,
  applyAction,
  type CardDatabase,
  type EngineError,
  type GameEvent,
  type GameState,
  legalActions,
  type PlayerId,
  seatView,
} from "@mtg/engine";
import { autoPasses } from "./auto-pass.ts";
import { autoTapAction } from "./auto-tap.ts";
import { type MatchState, withEvents } from "./match-state.ts";

/** Enough for any real game between two `advance` calls; reaching it means the host is stuck in a loop. */
export const MOST_ACTIONS = 100_000;

/** What the host does next: an action to apply, from a match that may have moved an agent's random state on. */
type HostStep = { match: MatchState; action: Action };

/**
 * Thrown when the host's own seats (agents, auto-pass) take `MOST_ACTIONS` actions in a row: an agent going round in
 * circles, never a person. A subclass so a caller can tell it from a bug in what it called (the eval counts the game
 * void, D-145).
 */
export class HostStuck extends Error {}

/** Acts for the host until a person must decide or the game ends. */
export function advance(match: MatchState, cards: CardDatabase): MatchState {
  let m = match;
  for (let i = 0; i < MOST_ACTIONS; i++) {
    const next = advanceOne(m, cards);
    if (next === null) return m;
    m = next;
  }
  throw new HostStuck(`the host took ${MOST_ACTIONS} actions without anyone deciding`);
}

/**
 * The host's next action alone, or null when a person must decide (or the game is over): `advance` a step at a time,
 * for a caller that shows what happens along the way (the web app's pacing, D-172). It doesn't count steps: a caller
 * looping it keeps its own limit, as `advance` does.
 */
export function advanceOne(match: MatchState, cards: CardDatabase): MatchState | null {
  const step = hostStep(match, cards);
  return step === null ? null : applied(step.match, step.action, cards);
}

/** Who must decide now, if a person: the player the UI should ask. Null while the host or no one acts. */
export function waitingOn(match: MatchState, cards: CardDatabase): PlayerId | null {
  const pending = match.state.pending;
  if (match.state.result !== null || pending === null) return null;
  return hostStep(match, cards) === null ? pending.player : null;
}

/** Applies a person's action. Refused if it isn't a person's seat or the engine refuses it. */
export function submit(
  match: MatchState,
  action: Action,
  cards: CardDatabase,
): { ok: true; match: MatchState } | { ok: false; error: EngineError } {
  if (match.seats[action.player]?.kind !== "human") {
    return { ok: false, error: { code: "illegalAction", message: `${action.player} isn't a person's seat` } };
  }
  const result = applyAction(match.state, action, cards);
  if (!result.ok) return result;
  return { ok: true, match: logged(match, action, result.state, result.events) };
}

/** The host's next step, or null when a person decides (or no one: the game is over). */
function hostStep(match: MatchState, cards: CardDatabase): HostStep | null {
  const { state } = match;
  const pending = state.pending;
  if (state.result !== null || pending === null) return null;
  const player = pending.player;
  const seat = match.seats[player];
  const settings = match.settings[player];
  if (seat === undefined || settings === undefined) throw new Error(`no seat for ${player}`);
  // Paying: the host's pick of sources, if the seat leaves it to the host and a way to pay exists. A heuristic seat
  // always does: it only starts what the engine's pick can pay (D-144).
  if (pending.kind === "payMana" && (settings.autoTap || seat.kind === "heuristic")) {
    const next = autoTapAction(state, cards);
    if (next !== null) return { match, action: next };
  }
  const actions = legalActions(state, player, cards);
  // No real choice: one legal answer is taken at once, so no one sees an empty prompt (ui.md, "Feel").
  if (pending.kind !== "priority" && actions.length === 1) return { match, action: actions[0] as Action };
  if (autoPasses(state, player, actions, settings, cards)) {
    const pass = actions.find((a) => a.type === "PASS_PRIORITY");
    if (pass !== undefined) return { match, action: pass };
  }
  if (seat.kind === "human") return null;
  if (seat.kind === "heuristic") return { match, action: heuristicAction(seatView(state, player, cards), cards) };
  // A built-in agent: its choice, and its random state moves on (kept in the match, never the game's, D-062).
  const choice = chooseAction(seat.agent, actions, seat.random);
  return {
    match: { ...match, seats: { ...match.seats, [player]: { ...seat, random: choice.seed } } },
    action: choice.action,
  };
}

function applied(match: MatchState, action: Action, cards: CardDatabase): MatchState {
  const result = applyAction(match.state, action, cards);
  if (!result.ok) throw new Error(`the host's own action was refused: ${result.error.message}`);
  return logged(match, action, result.state, result.events);
}

function logged(match: MatchState, action: Action, state: GameState, events: readonly GameEvent[]): MatchState {
  return withEvents({ ...match, actions: [...match.actions, action], state }, events);
}
