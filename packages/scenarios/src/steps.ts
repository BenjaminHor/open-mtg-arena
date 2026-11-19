// Turning scenario steps into engine actions (docs/testing.md, "Steps"). Every action comes from `legalActions()`, so
// a step that names something illegal fails, unless the next step is `expect error`.

import {
  type Action,
  type Answer,
  applyAction,
  autoPay,
  type CardDatabase,
  type GameState,
  type PlayerId,
} from "@mtg/engine";
import { deepEqual } from "./compare.ts";
import type { ScenarioStep } from "./format.ts";

export type { Game } from "./apply.ts";

import { allPass } from "./all-pass.ts";
import { apply, type Game, legal } from "./apply.ts";
import { abilityNamed, cardIn, cardNamed, paymentFrom, targetNamed } from "./lookups.ts";
import { nameOf } from "./names.ts";

/** A step that changes the game: passing or choosing. */
export type ActionStep = Extract<ScenarioStep, { kind: "pass" | "allPass" | "choose" | "activate" | "play" | "cast" }>;

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
    case "allPass":
      return allPass(game, step.until, cards, afterEach);
    case "play": {
      const action = legal(
        game,
        step.player,
        cards,
        (a) => a.type === "PLAY_LAND" && nameOf(game.state, a.object, cards) === step.card,
        `play ${step.card}`,
      );
      return apply(game, action, cards, afterEach);
    }
    case "cast": {
      let next = apply(
        game,
        legal(
          game,
          step.player,
          cards,
          (a) => a.type === "CAST_SPELL" && nameOf(game.state, a.object, cards) === step.card,
          `cast ${step.card}`,
        ),
        cards,
        afterEach,
      );
      for (const value of step.targets) {
        const target = targetNamed(next.state, value, cards);
        const answer = legal(
          next,
          step.player,
          cards,
          (a) => a.type === "ANSWER" && deepEqual(a.answer, { kind: "chooseTarget", target }),
          `target ${String(value)}`,
        );
        next = apply(next, answer, cards, afterEach);
      }
      // With no targets listed the cast may stop at the first target choice; with some listed, they must all be there.
      if (step.targets.length > 0 && next.state.pending?.kind === "chooseTarget") {
        throw new Error(`cast ${step.card}: it needs more targets than the ${step.targets.length} listed`);
      }
      if (step.pay !== undefined && next.state.pending?.kind !== "payMana") {
        throw new Error(`cast ${step.card}: "pay" was given, but the cast isn't waiting for a payment`);
      }
      for (const action of paymentActions(next, step, cards)) {
        const found = legal(
          next,
          step.player,
          cards,
          (a) => deepEqual({ ...a, decisionId: "" }, { ...action, decisionId: "" }),
          "pay",
        );
        next = apply(next, found, cards, afterEach);
      }
      return next;
    }
    case "activate": {
      const { object, ability } = abilityNamed(game.state, step, cards);
      const action = legal(
        game,
        step.player,
        cards,
        (a) => a.type === "ACTIVATE_ABILITY" && a.object === object && deepEqual(a.ability, ability),
        `activate ${step.card}`,
      );
      return apply(game, action, cards, afterEach);
    }
    case "choose": {
      const answer = answerFor(game.state, step.player, step.value, cards, "legal");
      const action = legal(
        game,
        step.player,
        cards,
        (a) => a.type === "ANSWER" && deepEqual(a.answer, answer),
        `choose ${String(step.value)}`,
      );
      return apply(game, action, cards, afterEach);
    }
  }
}

/**
 * For a step followed by `expect error`: sends the step's actions directly, without looking them up in `legalActions()`,
 * and returns the first rejection, or null if every action was accepted. A `cast` is several actions (the cast, each
 * target, the payment); the first one rejected is the one that counts.
 */
export function firstRejection(
  game: Game,
  step: ActionStep,
  cards: CardDatabase,
): { code: string; message: string } | null {
  let state = game.state;
  // A cast's payment is planned once, when the payment decision comes up, then carried out action by action.
  let payment: Action[] | null = null;
  for (let i = 0; ; i++) {
    let action: Action | null;
    if (step.kind === "cast" && i > step.targets.length) {
      payment ??= paymentActions({ state, events: [] }, step, cards);
      const next = payment[i - 1 - step.targets.length];
      action =
        next === undefined || next.type === "CONCEDE"
          ? (next ?? null)
          : { ...next, decisionId: state.pending?.id ?? "d0" };
    } else {
      action = directAction(state, step, cards, i);
    }
    if (action === null) return null;
    const result = applyAction(state, action, cards);
    if (!result.ok) return result.error;
    state = result.state;
  }
}

/**
 * The i-th action of a step, built from the current state, or null when the step has no more actions. A cast's
 * payment actions come from `paymentActions`, planned once by the caller.
 */
function directAction(state: GameState, step: ActionStep, cards: CardDatabase, i: number): Action | null {
  const decisionId = state.pending?.id ?? "d0";
  if (step.kind === "allPass") {
    throw new Error('"all pass" can\'t be followed by expect error: name the one player whose pass is illegal');
  }
  const player = step.player as PlayerId;
  switch (step.kind) {
    case "pass":
      return i === 0 ? { type: "PASS_PRIORITY", decisionId, player } : null;
    case "choose":
      return i === 0
        ? { type: "ANSWER", decisionId, player, answer: answerFor(state, step.player, step.value, cards, "any") }
        : null;
    case "activate": {
      if (i > 0) return null;
      const { object, ability } = abilityNamed(state, step, cards, "any");
      return { type: "ACTIVATE_ABILITY", decisionId, player, object, ability };
    }
    case "play":
      return i === 0
        ? { type: "PLAY_LAND", decisionId, player, object: cardIn(state, player, step.card, cards) }
        : null;
    case "cast": {
      if (i === 0) return { type: "CAST_SPELL", decisionId, player, object: cardIn(state, player, step.card, cards) };
      const target = step.targets[i - 1];
      return target === undefined
        ? null
        : {
            type: "ANSWER",
            decisionId,
            player,
            answer: { kind: "chooseTarget", target: targetNamed(state, target, cards) },
          };
    }
  }
}

/**
 * The actions that pay for a spell being cast: `auto` activates what autoPay picks, then pays; `{ R: 1 }` pays that from
 * the pool; `cancel` cancels the cast; no `pay` leaves the payment decision pending.
 */
function paymentActions(game: Game, step: Extract<ScenarioStep, { kind: "cast" }>, cards: CardDatabase): Action[] {
  const pending = game.state.pending;
  const player = step.player as PlayerId;
  if (step.pay === undefined || pending?.kind !== "payMana") return [];
  const decisionId = pending.id;
  if (step.pay === "cancel") return [{ type: "ANSWER", decisionId, player, answer: { kind: "cancelCast" } }];
  if (step.pay === "auto") {
    const plan = autoPay(game.state, player, pending.cost, cards);
    if (plan === null) throw new Error("pay: auto found no way to pay");
    return [
      ...plan.activations.map(
        (a) => ({ type: "ACTIVATE_ABILITY", decisionId, player, object: a.object, ability: a.ability }) as const,
      ),
      { type: "ANSWER", decisionId, player, answer: { kind: "payMana", payment: plan.payment } },
    ];
  }
  return [{ type: "ANSWER", decisionId, player, answer: { kind: "payMana", payment: paymentFrom(step.pay) } }];
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
    case "chooseTarget":
      if (value === "cancel") return { kind: "cancelCast" };
      return { kind: "chooseTarget", target: targetNamed(state, value, cards) };
    case "payMana": {
      if (value === "cancel") return { kind: "cancelCast" };
      return { kind: "payMana", payment: paymentFrom(value) };
    }
    case "priority":
      throw new Error("the player has priority: use pass, play, cast or activate");
  }
}
