// Running one scenario: build the game from its setup, take each step, check each expectation and every state's
// invariants. Returns the problems found; an empty list means the scenario passed. No file I/O here: callers pass
// the YAML text (the tests and, from M1-17, the CLI).

import { applyAction, type CardDatabase, createGame, type GameState } from "@mtg/engine";
import { expectationProblems } from "./expect.ts";
import { parseScenario, type Scenario } from "./format.ts";
import { invariantProblems } from "./invariants.ts";
import { buildSetup } from "./setup.ts";
import { type ActionStep, actionFor, type Game, takeStep } from "./steps.ts";

export type ScenarioResult = { name: string; problems: string[] };

/** Checks one state; the default is the engine's invariants. Tests replace it to prove every state is checked. */
export type StateCheck = (state: GameState, cards: CardDatabase) => string[];

export function runScenario(
  text: string,
  cards: CardDatabase,
  checkState: StateCheck = invariantProblems,
): ScenarioResult {
  let scenario: Scenario;
  try {
    scenario = parseScenario(text);
  } catch (error) {
    return { name: "(unreadable scenario)", problems: [message(error)] };
  }
  try {
    return { name: scenario.name, problems: run(scenario, cards, checkState) };
  } catch (error) {
    return { name: scenario.name, problems: [message(error)] };
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function run(scenario: Scenario, cards: CardDatabase, checkState: StateCheck): string[] {
  const created = createGame(buildSetup(scenario.setup, cards), cards);
  if (scenario.expectSetupError !== null) {
    if (created.ok) return [`expected the setup to be rejected (${scenario.expectSetupError}), but it started`];
    return created.error.message.includes(scenario.expectSetupError)
      ? []
      : [`setup rejected with "${created.error.message}", expected "${scenario.expectSetupError}"`];
  }
  if (!created.ok) return [`setup rejected: ${created.error.message}`];

  const checkInvariants = (g: Game) => {
    const problems = checkState(g.state, cards);
    if (problems.length > 0) throw new Error(`invariant broken: ${problems.join("; ")}`);
  };
  let game: Game = { state: created.state, events: created.events };
  checkInvariants(game);
  // `events contains` looks at the events of the last step that changed the game.
  let recentFrom = 0;
  const steps = scenario.steps;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const where = `step ${i + 1}`;
    if (step === undefined) continue;
    switch (step.kind) {
      case "expect": {
        const problems = expectationProblems(game.state, step.expectations, game.events.slice(recentFrom), cards);
        if (problems.length > 0) return problems.map((p) => `${where}: ${p}`);
        break;
      }
      case "expectError":
        return [`${where}: "expect error" must follow the step that should be rejected`];
      case "unsupported":
        return [`${where}: "${step.word}" steps arrive in ${step.arrives}`];
      case "pass":
      case "allPass":
      case "choose":
      case "activate": {
        const next = steps[i + 1];
        if (next?.kind === "expectError") {
          const problem = rejected(game, step, next.code, cards);
          if (problem !== null) return [`${where}: ${problem}`];
          i++;
          break;
        }
        recentFrom = game.events.length;
        try {
          game = takeStep(game, step, cards, checkInvariants);
        } catch (error) {
          return [`${where}: ${error instanceof Error ? error.message : String(error)}`];
        }
        break;
      }
    }
  }
  return [];
}

/** The step must be rejected with this error code. Returns a problem, or null if it was. */
function rejected(game: Game, step: ActionStep, code: string, cards: CardDatabase): string | null {
  const action = actionFor(game, step, cards);
  const result = applyAction(game.state, action, cards);
  if (result.ok) return `expected error ${code}, but the action was accepted`;
  if (result.error.code !== code) return `expected error ${code}, got ${result.error.code} (${result.error.message})`;
  return null;
}
