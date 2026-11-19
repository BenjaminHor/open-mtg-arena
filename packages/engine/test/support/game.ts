// Helpers for engine tests that play through decisions. Every state they produce is checked against the engine's
// invariants (CLAUDE.md, docs/testing.md "Invariant fuzzing"): plain JSON, a JSON round trip, and every listed legal
// action accepted by applyAction. Actions are only ever chosen from legalActions, as the scenario runner will.

import { expect } from "vitest";
import {
  type Action,
  type Answer,
  applyAction,
  createGame,
  type GameEvent,
  type GameSetup,
  type GameState,
  legalActions,
  type PlayerId,
  type PlayerSetup,
} from "../../src/index.ts";
import { emptyManaPool } from "../../src/state/mana.ts";
import { TEST_CARDS } from "./cards.ts";
import { plainJsonProblems } from "./plain-json.ts";

export function playerSetup(id: PlayerId, fields: Partial<PlayerSetup> = {}): PlayerSetup {
  return {
    id,
    life: 20,
    library: [],
    hand: [],
    battlefield: [],
    graveyard: [],
    exile: [],
    manaPool: emptyManaPool(),
    ...fields,
  };
}

/** A standard two-player game with 40-card decks of the given card. */
export function standardSetup(fields: Partial<GameSetup> = {}): GameSetup {
  return {
    seed: 42,
    players: [
      playerSetup("p1", { library: Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? "forest" : "grizzly-bears")) }),
      playerSetup("p2", { library: Array.from({ length: 40 }, () => "mountain") }),
    ],
    opening: { kind: "standard", firstPlayer: null },
    ruleModifiers: [],
    ...fields,
  };
}

export type Game = { state: GameState; events: GameEvent[] };

/** Freezes a value all the way down, so any attempt to mutate it throws (D-021: the engine never mutates its input). */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

export function start(setup: GameSetup): Game {
  const result = createGame(deepFreeze(structuredClone(setup)), TEST_CARDS);
  if (!result.ok) throw new Error(`createGame failed: ${result.error.message}`);
  checkInvariants(result.state);
  return { state: deepFreeze(result.state), events: result.events };
}

/** The pending player answers. The answer must be one of the legal actions. */
export function answer(game: Game, answer: Answer): Game {
  const player = pendingPlayer(game.state);
  const action = legalActions(game.state, player, TEST_CARDS).find(
    (a) => JSON.stringify(a.type === "ANSWER" && a.answer) === JSON.stringify(answer),
  );
  if (action === undefined) throw new Error(`${JSON.stringify(answer)} isn't a legal answer for ${player}`);
  return act(game, action);
}

export function act(game: Game, action: Action): Game {
  const result = applyAction(deepFreeze(game.state), action, TEST_CARDS);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.error.message}`);
  checkInvariants(result.state);
  return { state: deepFreeze(result.state), events: [...game.events, ...result.events] };
}

/** Whoever is pending takes the first legal action matching. */
export function take(game: Game, match: (a: Action) => boolean): Game {
  const pending = game.state.pending;
  if (pending === null) throw new Error("nothing pending");
  const action = legalActions(game.state, pending.player, TEST_CARDS).find(match);
  if (action === undefined) throw new Error("no such legal action");
  return act(game, action);
}

/** Two players pass priority in a row: with two players, the top of the stack resolves or the step ends (CR 117.4). */
export function passBoth(game: Game): Game {
  const pass = (a: Action) => a.type === "PASS_PRIORITY";
  return take(take(game, pass), pass);
}

export function pendingPlayer(state: GameState): PlayerId {
  if (state.pending === null) throw new Error("Nothing is pending");
  return state.pending.player;
}

export function checkInvariants(state: GameState): void {
  expect(plainJsonProblems(state)).toStrictEqual([]);
  expect(JSON.parse(JSON.stringify(state))).toStrictEqual(state);
  // The engine never stalls: it waits for someone, or the game is over.
  expect(state.pending !== null || state.result !== null).toBe(true);
  // Every object is in exactly one zone, and every zone entry is an object.
  const listed = [
    ...Object.values(state.zones.players).flatMap((z) => [...z.library, ...z.hand, ...z.graveyard]),
    ...state.zones.battlefield,
    ...state.zones.stack,
    ...state.zones.exile,
    ...state.zones.command,
  ];
  expect([...listed].sort()).toStrictEqual(Object.keys(state.objects).sort());
  // A spell on the stack carries its casting choices; a card anywhere else has none (objects.ts).
  for (const [id, obj] of Object.entries(state.objects)) {
    if (obj.kind !== "card") continue;
    expect(obj.choices === null, id).toBe(!state.zones.stack.includes(obj.id));
  }
  // Every listed legal action is accepted, and nothing in the state is mutated by trying them.
  const frozen = deepFreeze(state);
  for (const player of state.turnOrder) {
    for (const action of legalActions(frozen, player, TEST_CARDS)) {
      expect(applyAction(frozen, action, TEST_CARDS).ok, JSON.stringify(action)).toBe(true);
    }
  }
  // And the other direction, where it can be checked exhaustively: no card outside the hand can go to the bottom or
  // be discarded.
  const pending = state.pending;
  if (pending?.kind === "mulliganBottom" || pending?.kind === "discardToHandSize") {
    const inHand = state.zones.players[pending.player]?.hand ?? [];
    for (const object of Object.keys(state.objects) as `o${number}`[]) {
      if (inHand.includes(object)) continue;
      const action = {
        type: "ANSWER",
        decisionId: pending.id,
        player: pending.player,
        answer: { kind: pending.kind, object },
      } as const;
      expect(applyAction(frozen, action, TEST_CARDS).ok, object).toBe(false);
    }
  }
  // A card already chosen to discard can't be chosen again.
  if (pending?.kind === "discardToHandSize") {
    for (const object of pending.chosen) {
      const answerValue = { kind: "discardToHandSize", object } as const;
      const action = { type: "ANSWER", decisionId: pending.id, player: pending.player, answer: answerValue } as const;
      expect(applyAction(frozen, action, TEST_CARDS).ok, object).toBe(false);
    }
  }
}
