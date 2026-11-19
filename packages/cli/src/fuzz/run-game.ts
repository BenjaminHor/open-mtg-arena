// One fuzzed game: random legal actions (sometimes the first legal one), every check after every action, and the
// whole game kept, so a failure can be written out and replayed.

import { DECKS, type DeckList, POOL } from "@mtg/cards";
import {
  type Action,
  applyAction,
  type CardDatabase,
  createGame,
  ENGINE_VERSION,
  type GameEvent,
  type GameState,
  legalActions,
} from "@mtg/engine";
import { chooseAction, nextRandom } from "../agents.ts";
import { deckGameSetup } from "../deck-setup.ts";
import { FORMAT, type GameFile, replay } from "../game-file.ts";
import type { Check } from "./checks.ts";

export type FuzzResult =
  | { ok: true; file: GameFile; state: GameState }
  | { ok: false; problem: string; file: FailureFile };

/** A failed game: the game file up to the failing action (`pnpm cli replay` opens it), that action and the problem. */
export type FailureFile = GameFile & { problem: string; failingAction: Action | null };

/** Per decision. Games run about 2,000 decisions, so about one game in ten ends in a concession. */
const CONCEDE_CHANCE = 1 / 20_000;

/** Past this many turns a game is flagged as a likely loop (decks of 40 run out long before). */
export const TURN_CAP = 200;

/**
 * Plays the game for this seed. Even seeds are the prebuilt decks; odd seeds, random decks from the pool. The seed
 * also seeds the agent, so one number reruns one game.
 */
export function fuzzGame(seed: number, checks: readonly Check[], cards: CardDatabase, turnCap = TURN_CAP): FuzzResult {
  const decks = seed % 2 === 0 ? [DECKS["red-aggro"], DECKS["green-stompy"]] : randomDecks(seed);
  const setup = deckGameSetup(decks as DeckList[], seed, null);
  const actions: Action[] = [];
  const fail = (problem: string, failingAction: Action | null): FuzzResult => ({
    ok: false,
    problem,
    file: { format: FORMAT, version: ENGINE_VERSION, setup, actions: [...actions], problem, failingAction },
  });
  // Every check, on one step; a check that throws is a failure too (it calls the engine: every legal action is tried).
  const checkStep = (before: GameState, after: GameState, events: GameEvent[]): string | null => {
    for (const check of checks) {
      try {
        const problems = check(before, after, events, cards);
        if (problems.length > 0) return problems.join("; ");
      } catch (error) {
        return `a check threw: ${message(error)}`;
      }
    }
    return null;
  };
  let created: ReturnType<typeof createGame>;
  try {
    created = createGame(setup, cards);
  } catch (error) {
    return fail(`createGame threw: ${message(error)}`, null);
  }
  if (!created.ok) return fail(`the setup is rejected: ${created.error.message}`, null);
  let state: GameState = created.state;
  const opening = checkStep(state, state, created.events);
  if (opening !== null) return fail(opening, null);
  let rng = seed;
  while (state.result === null) {
    if ((state.turn?.number ?? 0) > turnCap) return fail(`the game passed ${turnCap} turns: a likely loop`, null);
    const pending = state.pending;
    if (pending === null) return fail("the engine stalled: nothing pending and no result", null);
    // Mostly random; one decision in ten the first legal action, which passes and declines, so games move on. Rarely
    // a player concedes, which can happen at any time (CR 104.3a) and isn't among the legal actions (D-042).
    const roll = nextRandom(rng);
    rng = roll.seed;
    let action: Action;
    if (roll.value < CONCEDE_CHANCE) {
      const who = nextRandom(rng);
      rng = who.seed;
      action = {
        type: "CONCEDE",
        player: state.turnOrder[Math.floor(who.value * state.turnOrder.length)] ?? pending.player,
      };
    } else {
      let legal: Action[];
      try {
        legal = legalActions(state, pending.player, cards);
      } catch (error) {
        return fail(`legalActions threw: ${message(error)}`, null);
      }
      if (legal.length === 0) return fail(`nothing legal for ${pending.player}'s ${pending.kind} decision`, null);
      const choice = chooseAction(roll.value < 0.1 ? "first-legal" : "random", state, legal, rng);
      rng = choice.seed;
      action = choice.action;
    }
    let result: ReturnType<typeof applyAction>;
    try {
      result = applyAction(state, action, cards);
    } catch (error) {
      return fail(`applyAction threw: ${message(error)}`, action);
    }
    if (!result.ok) return fail(`a legal action was rejected: ${result.error.message}`, action);
    const problem = checkStep(state, result.state, result.events);
    if (problem !== null) return fail(problem, action);
    actions.push(action);
    state = result.state;
  }
  // Determinism: replaying the log from the setup gives the very same state. Checked once, at the end: replaying after
  // every action would make a game quadratic, and any difference shows in the final state anyway.
  try {
    if (JSON.stringify(replay(setup, actions, cards).state) !== JSON.stringify(state)) {
      return fail("replaying the game gives a different state", null);
    }
  } catch (error) {
    return fail(`replaying the game throws: ${message(error)}`, null);
  }
  return { ok: true, file: { format: FORMAT, version: ENGINE_VERSION, setup, actions }, state };
}

/**
 * Two random 40-card decks from the pool: 17 basic lands, a random mix of Mountains and Forests, and 23 random nonland
 * cards, so some decks can't cast much of what they draw, which tests that too.
 */
function randomDecks(seed: number): DeckList[] {
  // Not `seed` itself, which the agent's choices start from: the two would begin with the same numbers.
  let rng = (seed ^ 0x9e3779b9) >>> 0;
  const nextRandomValue = (): number => {
    const r = nextRandom(rng);
    rng = r.seed;
    return r.value;
  };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(nextRandomValue() * items.length)] as T;
  const nonlands = POOL.cards.filter((c) => !c.typeLine.includes("Land")).map((c) => c.name);
  return [1, 2].map((n) => {
    const mountains = Math.floor(nextRandomValue() * 18);
    const counts = new Map<string, number>([
      ["Mountain", mountains],
      ["Forest", 17 - mountains],
    ]);
    for (let i = 0; i < 23; i++) {
      const card = pick(nonlands);
      counts.set(card, (counts.get(card) ?? 0) + 1);
    }
    const cards = [...counts].filter(([, count]) => count > 0).map(([card, count]) => ({ card, count }));
    return { name: `random-${seed}-${n}`, cards };
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
