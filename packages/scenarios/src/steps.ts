// Turning scenario steps into engine actions (docs/testing.md, "Steps"). Every action comes from `legalActions()`, so
// a step that names something illegal fails, unless the next step is `expect error`.

import {
  type Action,
  type Answer,
  applyAction,
  type CardDatabase,
  type GameEvent,
  type GameState,
  legalActions,
  type ObjectId,
  type PlayerId,
} from "@mtg/engine";
import type { ScenarioStep } from "./format.ts";
import { engineStep, nameOf } from "./names.ts";

export type Game = { state: GameState; events: GameEvent[] };

/** A step that changes the game: passing or choosing. */
export type ActionStep = Extract<ScenarioStep, { kind: "pass" | "allPass" | "choose" }>;

/** The most passes `all pass: until` makes before giving up, so a step that never comes fails instead of hanging. */
const MAX_PASSES = 500;

/** Applies a step's actions, each checked by `afterEach`. Throws a readable message when the step can't be taken. */
export function takeStep(game: Game, step: ActionStep, cards: CardDatabase, afterEach: (g: Game) => void): Game {
  switch (step.kind) {
    case "pass":
      return apply(
        game,
        legal(game, step.player, cards, (a) => a.type === "PASS_PRIORITY", "pass"),
        cards,
        afterEach,
      );
    case "allPass": {
      if (step.until === null) {
        let next = game;
        for (const _ of game.state.turnOrder) next = passByWhoeverHasPriority(next, cards, afterEach);
        return next;
      }
      const target = engineStep(step.until);
      let next = game;
      let begun = false;
      for (let passes = 0; passes < MAX_PASSES; passes++) {
        const before = next.events.length;
        next = passByWhoeverHasPriority(next, cards, afterEach);
        begun ||= next.events.slice(before).some((e) => e.type === "STEP_BEGAN" && e.step === target);
        if (begun && next.state.pending?.kind === "priority" && next.state.turn?.step === target) return next;
      }
      throw new Error(`"all pass: until ${step.until}" didn't reach that step with priority in ${MAX_PASSES} passes`);
    }
    case "choose": {
      const answer = answerFor(game.state, step.player, step.value, cards, "legal");
      const action = legal(
        game,
        step.player,
        cards,
        (a) => a.type === "ANSWER" && same(a.answer, answer),
        `choose ${String(step.value)}`,
      );
      return apply(game, action, cards, afterEach);
    }
  }
}

/** Builds the action a step names without checking it's legal, for a step followed by `expect error`. */
export function actionFor(game: Game, step: ActionStep, cards: CardDatabase): Action {
  const decisionId = game.state.pending?.id ?? "d0";
  switch (step.kind) {
    case "pass":
      return { type: "PASS_PRIORITY", decisionId, player: step.player as PlayerId };
    case "allPass":
      throw new Error('"all pass" can\'t be followed by expect error: name the one player whose pass is illegal');
    case "choose":
      return {
        type: "ANSWER",
        decisionId,
        player: step.player as PlayerId,
        answer: answerFor(game.state, step.player, step.value, cards, "any"),
      };
  }
}

function passByWhoeverHasPriority(game: Game, cards: CardDatabase, afterEach: (g: Game) => void): Game {
  const pending = game.state.pending;
  if (pending?.kind !== "priority")
    throw new Error(`expected someone to have priority, but the game waits for ${pending?.kind ?? "nothing"}`);
  return apply(
    game,
    legal(game, pending.player, cards, (a) => a.type === "PASS_PRIORITY", "pass"),
    cards,
    afterEach,
  );
}

/** The answer a `choose:` value names, for the pending decision. Exhaustive, so new decision kinds must be handled. */
function answerFor(
  state: GameState,
  player: string,
  value: unknown,
  cards: CardDatabase,
  which: "legal" | "any",
): Answer {
  const pending = state.pending;
  if (pending === null) throw new Error("nothing is pending to choose for");
  const text = String(value);
  switch (pending.kind) {
    case "chooseStartingPlayer":
      return { kind: "chooseStartingPlayer", player: text as PlayerId };
    case "mulligan":
      if (text !== "keep" && text !== "mulligan")
        throw new Error(`a mulligan decision takes keep or mulligan, got ${text}`);
      return { kind: "mulligan", choice: text };
    case "mulliganBottom":
    case "discardToHandSize":
      return { kind: pending.kind, object: cardNamed(state, player, text, cards, which) };
    case "priority":
      throw new Error("the player has priority: use pass (casting and the rest arrive with their tasks)");
  }
}

/**
 * A card with this name among the player's legal answers. With several identical cards (eight Forests), the first in
 * zone order that's still a legal answer is used. For an illegal attempt (`expect error`), any card with the name,
 * wherever it is.
 */
function cardNamed(
  state: GameState,
  player: string,
  name: string,
  cards: CardDatabase,
  which: "legal" | "any",
): ObjectId {
  const answers = legalActions(state, player as PlayerId, cards).flatMap((a) =>
    a.type === "ANSWER" && "object" in a.answer ? [a.answer.object] : [],
  );
  const pool = which === "legal" ? answers : [...answers, ...(Object.keys(state.objects) as ObjectId[])];
  const found = pool.find((id) => nameOf(state, id, cards) === name);
  if (found === undefined) throw new Error(`no ${name} for ${player} to choose`);
  return found;
}

function legal(game: Game, player: string, cards: CardDatabase, match: (a: Action) => boolean, what: string): Action {
  const actions = legalActions(game.state, player as PlayerId, cards);
  const found = actions.find(match);
  if (found !== undefined) return found;
  const pending = game.state.pending;
  throw new Error(
    `${player} can't ${what}: it isn't a legal action (pending: ${pending === null ? "nothing" : `${pending.kind} for ${pending.player}`})`,
  );
}

function apply(game: Game, action: Action, cards: CardDatabase, afterEach: (g: Game) => void): Game {
  const result = applyAction(game.state, action, cards);
  if (!result.ok) throw new Error(`a legal action was rejected: ${result.error.message}`);
  const next = { state: result.state, events: [...game.events, ...result.events] };
  afterEach(next);
  return next;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
