// The host's loop (architecture.md, "Match host"). `advance` takes every action the host may take on its own: an
// agent seat's choice, a decision with one legal answer, auto-pass and auto-tap. It stops when a person must decide
// (or the game is over), and the UI shows that decision. `submit` applies the person's action. Both are pure: a match
// in, a new match out; every action is logged, so the log replays the match exactly.

import { chooseAction } from "@mtg/ai";
import {
  type Action,
  applyAction,
  type CardDatabase,
  type EngineError,
  type GameEvent,
  type GameState,
  legalActions,
  type PlayerId,
} from "@mtg/engine";
import { autoPasses } from "./auto-pass.ts";
import { autoTapActions } from "./auto-tap.ts";
import { type MatchState, withEvents } from "./match-state.ts";

/** Enough for any real game between two `advance` calls; reaching it means the host is stuck in a loop. */
const MOST_ACTIONS = 100_000;

/** What the host does next: actions to apply, from a match that may have moved an agent's random state on. */
type HostStep = { match: MatchState; actions: Action[] };

/** Acts for the host until a person must decide or the game ends. */
export function advance(match: MatchState, cards: CardDatabase): MatchState {
  let m = match;
  for (let i = 0; i < MOST_ACTIONS; i++) {
    const step = hostStep(m, cards);
    if (step === null) return m;
    m = step.actions.reduce((acc, action) => applied(acc, action, cards), step.match);
  }
  throw new Error(`the host took ${MOST_ACTIONS} actions without anyone deciding`);
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
  // Paying: the host's pick of sources, if the seat leaves it to the host and a way to pay exists. One action at a
  // time: each mana ability activated is a new decision to answer, and the plan is made again with the mana it added.
  if (pending.kind === "payMana" && settings.autoTap) {
    const next = autoTapActions(state, cards)?.[0];
    if (next !== undefined) return { match, actions: [next] };
  }
  const actions = legalActions(state, player, cards);
  // No real choice: one legal answer is taken at once, so no one sees an empty prompt (ui.md, "Feel").
  if (pending.kind !== "priority" && actions.length === 1) return { match, actions: [actions[0] as Action] };
  if (autoPasses(state, player, actions, settings, cards)) {
    const pass = actions.find((a) => a.type === "PASS_PRIORITY");
    if (pass !== undefined) return { match, actions: [pass] };
  }
  if (seat.kind === "human") return null;
  // A built-in agent: its choice, and its random state moves on (kept in the match, never the game's, D-062).
  const choice = chooseAction(seat.agent, actions, seat.random);
  return {
    match: { ...match, seats: { ...match.seats, [player]: { ...seat, random: choice.seed } } },
    actions: [choice.action],
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
