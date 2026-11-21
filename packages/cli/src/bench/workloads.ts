// What `pnpm bench` measures (docs/testing.md, section 6), on fixed states from a golden game, so every run measures
// the same work: applyAction on typical states, a whole random-legal game, and legalActions and characteristics on a
// busy board.

import { DECKS, type DeckList } from "@mtg/cards";
import {
  type Action,
  applyAction,
  type CardDatabase,
  characteristics,
  createGame,
  type GameState,
  layeredFresh,
  legalActions,
} from "@mtg/engine";
import { playAgents } from "../agent-play.ts";
import { deckGameSetup } from "../deck-setup.ts";
import { goldenFiles, readGolden } from "../golden.ts";

/** `run` does `count` operations (applyActions, games, ...); times are reported per operation. */
export type Workload = { name: string; what: string; count: number; run: () => void };

// The states come from the golden games: fixed, and as varied as real games get. Only the games listed in
// `BENCH_GAMES`, so adding a golden game for new cards doesn't quietly change what's measured (D-049); changing the
// list means a new baseline, explained in its commit.
/** The golden games the states come from: M1's four. */
const BENCH_GAMES = [
  "green-stompy-vs-green-stompy-33",
  "green-stompy-vs-red-aggro-2",
  "red-aggro-vs-green-stompy-1",
  "red-aggro-vs-red-aggro-3",
];
/** Setup seeds for the whole-game measure: a few games, so one unusual game doesn't decide it. */
const GAME_SEEDS = [11, 12, 13, 14, 15];

/** How many states each "typical states" measure takes, at most. */
const STATES = 40;

export function workloads(cards: CardDatabase): Workload[] {
  const steps = gameSteps(cards);
  const some = (keep: (s: GameState) => boolean, label: string): Step[] => {
    const found = steps.filter((step) => keep(step.state));
    if (found.length === 0) throw new Error(`the golden games have no ${label}`);
    // Spread over the games, not the first few in a row.
    const every = Math.max(1, Math.floor(found.length / STATES));
    return found.filter((_, i) => i % every === 0).slice(0, STATES);
  };
  const early = some((s) => s.turn !== null && s.zones.battlefield.length <= 2, "early turn");
  const combats = some((s) => s.combat !== null && s.zones.battlefield.length >= 20, "busy combat");
  const stacks = some((s) => s.zones.stack.length >= 2, "stack of two or more");
  const busiest = [...steps].sort((a, b) => b.state.zones.battlefield.length - a.state.zones.battlefield.length);
  const boards = busiest.slice(0, STATES).map((s) => s.state);
  const apply = (list: Step[]) => () => {
    for (const { state, action } of list) {
      if (!applyAction(state, action, cards).ok) throw new Error("a bench action was rejected");
    }
  };
  const games = GAME_SEEDS.map((seed) =>
    deckGameSetup([DECKS["red-aggro"], DECKS["green-stompy"]] as DeckList[], seed, null),
  );
  const permanents = (list: GameState[]) => list.reduce((n, s) => n + s.zones.battlefield.length, 0);
  return [
    {
      name: "applyAction.emptyBoard",
      what: `per action, ${early.length} with at most 2 permanents out`,
      count: early.length,
      run: apply(early),
    },
    {
      name: "applyAction.busyCombat",
      what: `per action, ${combats.length} in combat with 20 or more permanents out`,
      count: combats.length,
      run: apply(combats),
    },
    {
      name: "applyAction.deepStack",
      what: `per action, ${stacks.length} with 2 or more objects on the stack`,
      count: stacks.length,
      run: apply(stacks),
    },
    {
      name: "randomGame",
      what: `per game between the random agents (setup seeds ${GAME_SEEDS.join(", ")} in turn)`,
      count: 1,
      run: () => {
        const setup = games[next++ % games.length];
        const created = setup === undefined ? null : createGame(setup, cards);
        if (created === null || !created.ok) throw new Error("the bench setup is rejected");
        playAgents(created.state, () => true, "random", 1, { maxActions: 100_000, maxTurns: 200 }, cards);
      },
    },
    {
      name: "legalActions.busyBoard",
      what: `per call, in the ${boards.length} busiest states`,
      count: boards.length,
      run: () => {
        for (const state of boards) if (state.pending !== null) legalActions(state, state.pending.player, cards);
      },
    },
    {
      name: "characteristics.busyBoard",
      what: `per permanent, all ${permanents(boards)} in the ${boards.length} busiest states`,
      count: permanents(boards),
      run: () => {
        for (const state of boards) for (const id of state.zones.battlefield) characteristics(state, id, cards);
      },
    },
    {
      // The layer pass itself, not a kept one (D-092): what a state with changed objects costs.
      name: "layers.freshPass",
      what: `per pass, in the ${boards.length} busiest states`,
      count: boards.length,
      run: () => {
        for (const state of boards) layeredFresh(state, cards);
      },
    },
  ];
}

let next = 0;

type Step = { state: GameState; action: Action };

/** Each state of every golden game, with the action taken in it. */
function gameSteps(cards: CardDatabase): Step[] {
  const steps: Step[] = [];
  const files = goldenFiles().filter((f) => BENCH_GAMES.some((name) => f.endsWith(`${name}.json`)));
  if (files.length !== BENCH_GAMES.length)
    throw new Error(`the bench needs the golden games ${BENCH_GAMES.join(", ")}`);
  for (const file of files) {
    const game = readGolden(file, cards);
    const created = createGame(game.setup, cards);
    if (!created.ok) throw new Error(created.error.message);
    let state = created.state;
    for (const action of game.actions) {
      steps.push({ state, action });
      const result = applyAction(state, action, cards);
      if (!result.ok) throw new Error(`${file} no longer plays out: ${result.error.message} (pnpm golden:update)`);
      state = result.state;
    }
  }
  return steps;
}
