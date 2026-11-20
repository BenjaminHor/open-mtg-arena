// Turning scenario steps into engine actions (docs/testing.md, "Steps"). Every action comes from `legalActions()`, so
// a step that names something illegal fails, unless the next step is `expect error`.

import {
  type Action,
  type Answer,
  applyAction,
  type CardDatabase,
  type Color,
  type GameState,
  type ObjectId,
  type PendingTrigger,
  type PlayerId,
} from "@mtg/engine";
import { deepEqual } from "./compare.ts";
import type { ScenarioStep } from "./format.ts";

export type { Game } from "./apply.ts";

import { allPass } from "./all-pass.ts";
import { type AfterEach, apply, type Game, legal } from "./apply.ts";
import { combatAction, declarationAnswer } from "./combat-steps.ts";
import {
  abilityNamed,
  cardIn,
  cardNamed,
  chooseCardsAnswer,
  isHandCard,
  paymentFrom,
  permanentNamed,
  targetNamed,
} from "./lookups.ts";
import { paymentActions, stackAnswer, targetsAndPayment, unusedListed } from "./stack-steps.ts";

/** A step that changes the game: passing or choosing. */
export type ActionStep = Extract<
  ScenarioStep,
  { kind: "pass" | "allPass" | "choose" | "activate" | "play" | "cast" | "attack" | "block" | "assign" | "concede" }
>;

/** Applies a step's actions, each checked by `afterEach`. Throws a readable message when the step can't be taken. */
export function takeStep(game: Game, step: ActionStep, cards: CardDatabase, afterEach: AfterEach): Game {
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
    case "concede":
      // Not looked up in legalActions: a player may concede at any time (CR 104.3a), so it's never listed.
      return apply(game, { type: "CONCEDE", player: step.player as PlayerId }, cards, afterEach);
    case "attack":
    case "block":
    case "assign": {
      let next = game;
      for (let i = 0; ; i++) {
        const action = combatAction(next.state, step, cards, i);
        if (action === null) return next;
        // Compared field by field: the same answer built with keys in another order is the same answer.
        next = apply(
          next,
          legal(next, step.player, cards, (a) => deepEqual(a, action), step.kind),
          cards,
          afterEach,
        );
      }
    }
    case "play": {
      const action = legal(
        game,
        step.player,
        cards,
        (a) => a.type === "PLAY_LAND" && isHandCard(game.state, step.player, a.object, step.card, cards),
        `play ${step.card}`,
      );
      return apply(game, action, cards, afterEach);
    }
    case "cast": {
      const next = apply(
        game,
        legal(
          game,
          step.player,
          cards,
          (a) => a.type === "CAST_SPELL" && isHandCard(game.state, step.player, a.object, step.card, cards),
          `cast ${step.card}`,
        ),
        cards,
        afterEach,
      );
      return targetsAndPayment(next, step, cards, afterEach);
    }
    case "activate": {
      const { object, ability } = abilityNamed(game.state, step, cards);
      const action = legal(
        game,
        step.player,
        cards,
        (a) =>
          a.type === "ACTIVATE_ABILITY" &&
          a.object === object &&
          deepEqual(a.ability, ability) &&
          (a.color ?? null) === step.color,
        `activate ${step.card}${step.color === null ? "" : ` for ${step.color}`}`,
      );
      // A mana ability resolves at once; another ability goes on the stack, then takes targets and payment.
      const next = apply(game, action, cards, afterEach);
      // `targets` and `pay` belong to an ability the activation put on the stack, not to a mana ability activated
      // while some other cost is being paid.
      const created = next.state.casting !== null && next.state.casting.object !== game.state.casting?.object;
      if (!created) {
        if (step.targets.length > 0 || step.pay !== undefined) {
          throw new Error(`activate ${step.card}: that ability doesn't go on the stack, so it takes no targets or pay`);
        }
        return next;
      }
      return targetsAndPayment(next, step, cards, afterEach);
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
 * and returns the first rejection, or null if every action was accepted. A `cast` or `activate` is several actions (the cast, each
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
  let paid = 0;
  // The spell or ability being cast or activated, and the sacrifices given, for the check that nothing listed went unused.
  let stackObject: ObjectId | null = null;
  let sacrificed = 0;
  for (let i = 0; ; i++) {
    let action: Action | null;
    if ((step.kind === "cast" || step.kind === "activate") && i > 0) {
      // After the cast itself: the step's answers to targets and a division, then its payment.
      stackObject ??= state.casting?.object ?? null;
      const found = stackAnswer(state, step, cards);
      const decisionId = state.pending?.id ?? "d0";
      if (found?.answer.kind === "chooseSacrifice") sacrificed++;
      if (found !== null) {
        action = { type: "ANSWER", decisionId, player: step.player as PlayerId, answer: found.answer };
      } else {
        if (payment === null) {
          // The step's answers are used up: check it listed nothing the spell didn't take.
          const unused = unusedListed(state, step, stackObject, sacrificed);
          if (unused !== null) throw new Error(unused);
        }
        payment ??= paymentActions({ state, events: [] }, step, cards);
        const next = payment[paid++];
        action = next === undefined || next.type === "CONCEDE" ? (next ?? null) : { ...next, decisionId };
      }
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
    case "concede":
      return i === 0 ? { type: "CONCEDE", player } : null;
    case "pass":
      return i === 0 ? { type: "PASS_PRIORITY", decisionId, player } : null;
    case "choose":
      return i === 0
        ? { type: "ANSWER", decisionId, player, answer: answerFor(state, step.player, step.value, cards, "any") }
        : null;
    case "activate": {
      if (i === 0) {
        const { object, ability } = abilityNamed(state, step, cards, "any");
        const action = { type: "ACTIVATE_ABILITY", decisionId, player, object, ability } as const;
        return step.color === null ? action : { ...action, color: step.color as Color };
      }
      return null;
    }
    case "play":
      return i === 0
        ? { type: "PLAY_LAND", decisionId, player, object: cardIn(state, player, step.card, cards) }
        : null;
    case "attack":
    case "block":
    case "assign":
      return combatAction(state, step, cards, i);
    case "cast":
      return i === 0
        ? { type: "CAST_SPELL", decisionId, player, object: cardIn(state, player, step.card, cards) }
        : null;
  }
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
    case "chooseTargetCount":
      if (value === "cancel") return { kind: "cancelCast" };
      return { kind: "chooseTargetCount", count: Number(value) };
    case "announceX":
      if (value === "cancel") return { kind: "cancelCast" };
      return { kind: "announceX", value: Number(value) };
    case "chooseSacrifice":
      if (value === "cancel") return { kind: "cancelCast" };
      return { kind: "chooseSacrifice", object: permanentNamed(state, player, value, cards) };
    case "divide":
      if (value === "cancel") return { kind: "cancelCast" };
      return { kind: "divide", amount: Number(value) };
    case "payMana": {
      if (value === "cancel") return { kind: "cancelCast" };
      return { kind: "payMana", payment: paymentFrom(value) };
    }
    case "chooseCards":
      return chooseCardsAnswer(state, text, cards);
    case "chooseYesNo":
      if (text !== "yes" && text !== "no") throw new Error(`a yes or no decision takes yes or no, got ${text}`);
      return { kind: "chooseYesNo", yes: text === "yes" };
    case "orderTriggers":
      return { kind: "orderTrigger", index: triggerNamed(pending.batch, player, text, cards) };
    case "declareAttackers":
    case "declareBlockers":
      return declarationAnswer(state, player, text, cards);
    case "assignDamage":
      throw new Error(`for ${pending.kind}, use the assign step`);
    case "priority":
      throw new Error("the player has priority: use pass, play, cast or activate");
  }
}

/**
 * The trigger of the batch a `choose:` names, by its source's card name, with `#n` for the nth of the player's triggers
 * from cards of that name: `p1 choose: Soul Warden`.
 */
function triggerNamed(batch: readonly PendingTrigger[], player: string, text: string, cards: CardDatabase): number {
  const [name, nth] = text.split("#");
  const theirs = batch.flatMap((t, i) =>
    t.controller === player && cards[t.sourceOracleId]?.printed.name === name ? [i] : [],
  );
  const index = theirs[(nth === undefined ? 1 : Number(nth)) - 1];
  if (index === undefined) throw new Error(`${player} has no triggered ability of ${text} waiting`);
  return index;
}
