// Taking one engine action in a scenario: found in `legalActions()`, applied, and checked.

import {
  type Action,
  applyAction,
  type CardDatabase,
  type GameEvent,
  type GameState,
  legalActions,
  type PlayerId,
} from "@mtg/engine";

export type Game = { state: GameState; events: GameEvent[] };

/** The first of the player's legal actions that matches, or a readable error naming what they couldn't do. */
export function legal(
  game: Game,
  player: string,
  cards: CardDatabase,
  match: (a: Action) => boolean,
  what: string,
): Action {
  const actions = legalActions(game.state, player as PlayerId, cards);
  const found = actions.find(match);
  if (found !== undefined) return found;
  const pending = game.state.pending;
  throw new Error(
    `${player} can't ${what}: it isn't a legal action (pending: ${pending === null ? "nothing" : `${pending.kind} for ${pending.player}`})`,
  );
}

/** Applies a legal action and checks the new state with `afterEach`. A legal action that's rejected is an engine bug. */
export function apply(game: Game, action: Action, cards: CardDatabase, afterEach: (g: Game) => void): Game {
  const result = applyAction(game.state, action, cards);
  if (!result.ok) throw new Error(`a legal action was rejected: ${result.error.message}`);
  const next = { state: result.state, events: [...game.events, ...result.events] };
  afterEach(next);
  return next;
}
