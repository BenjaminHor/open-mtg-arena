// The part `cast` and `activate` share (docs/testing.md, "Steps"): after the spell or ability is put on the stack, its
// targets in order, any division, then the payment (CR 601.2c–h, 602.2b).

import {
  type Action,
  type Answer,
  autoPay,
  type CardDatabase,
  type GameState,
  type ObjectId,
  type PlayerId,
} from "@mtg/engine";
import { type AfterEach, apply, type Game, legal } from "./apply.ts";
import { deepEqual } from "./compare.ts";
import type { ScenarioStep } from "./format.ts";
import { paymentFrom, permanentNamed, targetNamed } from "./lookups.ts";

export type StackStep = Extract<ScenarioStep, { kind: "cast" | "activate" }>;

/**
 * Announces `x`, chooses the listed targets (and how many, for an instance that takes a range), divides as `divide`
 * says, chooses what to `sacrifice`, then pays as `pay` says. With no targets listed it may stop at the first target
 * choice; with some listed, they must all be there. Without `pay` it stops at the payment decision; a cost with no mana
 * is paid as soon as its choices are made.
 */
export function targetsAndPayment(game: Game, step: StackStep, cards: CardDatabase, afterEach: AfterEach): Game {
  let next = game;
  // The spell or ability keeps its choices on the stack even once paid; the sacrifices are counted as they're given.
  const object = next.state.casting?.object ?? null;
  let sacrificed = 0;
  for (let found = stackAnswer(next.state, step, cards); found !== null; found = stackAnswer(next.state, step, cards)) {
    const { answer, label } = found;
    const action = legal(next, step.player, cards, (a) => a.type === "ANSWER" && deepEqual(a.answer, answer), label);
    if (answer.kind === "chooseSacrifice") sacrificed++;
    next = apply(next, action, cards, afterEach);
  }
  const pending = next.state.pending?.kind;
  if (pending === "announceX" && (step.targets.length > 0 || step.divide !== null)) {
    throw new Error(`${step.kind} ${step.card}: it announces X first: give x`);
  }
  if (step.targets.length > 0 && (pending === "chooseTarget" || pending === "chooseTargetCount")) {
    throw new Error(`${step.kind} ${step.card}: it needs more targets than the ${step.targets.length} listed`);
  }
  if (step.divide !== null && pending === "divide") {
    throw new Error(`${step.kind} ${step.card}: it needs more shares than the ${step.divide.length} listed`);
  }
  const unused = unusedListed(next.state, step, object, sacrificed);
  if (unused !== null) throw new Error(unused);
  if (step.pay !== undefined && pending !== "payMana") {
    throw new Error(`${step.kind} ${step.card}: "pay" was given, but it isn't waiting for a payment`);
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

/**
 * The answer this step gives the pending decision, or null when it has none: X, how many targets an instance has (its
 * list's length, or one), the next listed target, the next share, the next sacrifice. `label` says it as the scenario
 * wrote it, for messages.
 */
export function stackAnswer(
  state: GameState,
  step: StackStep,
  cards: CardDatabase,
): { answer: Answer; label: string } | null {
  const pending = state.pending;
  if (pending === null) return null;
  switch (pending.kind) {
    case "announceX":
      return step.x === null ? null : { answer: { kind: "announceX", value: step.x }, label: `X = ${step.x}` };
    case "chooseSacrifice": {
      const name = step.sacrifice?.[state.casting?.sacrifices.length ?? 0];
      if (name === undefined) return null;
      const object = permanentNamed(state, step.player, name, cards);
      return { answer: { kind: "chooseSacrifice", object }, label: `sacrifice ${name}` };
    }
    case "chooseTargetCount": {
      const listed = step.targets[pending.instance];
      if (listed === undefined) return null;
      const count = Array.isArray(listed) ? listed.length : 1;
      return { answer: { kind: "chooseTargetCount", count }, label: `${count} targets` };
    }
    case "chooseTarget": {
      const listed = step.targets[pending.instance];
      if (listed === undefined) return null;
      const names: unknown[] = Array.isArray(listed) ? listed : [listed];
      const chosen = state.objects[pending.object]?.choices?.targets[pending.instance]?.length ?? 0;
      const name = names[chosen];
      if (name === undefined) return null;
      return {
        answer: { kind: "chooseTarget", target: targetNamed(state, name, cards) },
        label: `target ${String(name)}`,
      };
    }
    case "divide": {
      if (step.divide === null) return null;
      // One share per target, adding up to the whole: the last is never asked for (it gets the rest), so the runner
      // checks it here rather than let a wrong list pass.
      const total = step.divide.reduce((sum, n) => sum + n, 0);
      if (step.divide.length !== pending.targets.length || total !== pending.amount) {
        throw new Error(
          `${step.kind} ${step.card}: divide lists one share per target (${pending.targets.length}), adding up to ${pending.amount}`,
        );
      }
      const amount = step.divide[pending.shares.length];
      return amount === undefined ? null : { answer: { kind: "divide", amount }, label: `a share of ${amount}` };
    }
    default:
      return null;
  }
}

/**
 * What the step listed that the spell or ability `object` never used, or null: more targets than it took (for any
 * instance), an X it doesn't have, a division it didn't ask for, more sacrifices than its cost took (`sacrificed`, the
 * number given). Checked once the answers stop, even if the cost was already paid, so a scenario can't claim a choice
 * that didn't happen.
 */
export function unusedListed(
  state: GameState,
  step: StackStep,
  object: ObjectId | null,
  sacrificed: number,
): string | null {
  const choices = object === null ? null : (state.objects[object]?.choices ?? null);
  if (choices === null) return null;
  const listed = step.targets.map((entry) => (Array.isArray(entry) ? entry.length : 1));
  const chosen = choices.targets.map((group) => group.length);
  if (step.targets.length > 0 && JSON.stringify(listed) !== JSON.stringify(chosen)) {
    return `${step.kind} ${step.card}: targets lists ${JSON.stringify(listed)} per instance, but it took ${JSON.stringify(chosen)}`;
  }
  if (step.x !== null && choices.x === null)
    return `${step.kind} ${step.card}: x is listed, but it has no X to announce`;
  if (step.sacrifice !== null && sacrificed !== step.sacrifice.length) {
    return `${step.kind} ${step.card}: sacrifice lists ${step.sacrifice.length}, but its cost took ${sacrificed}`;
  }
  if (step.divide !== null && (choices.division?.shares.length ?? 0) !== step.divide.length) {
    return `${step.kind} ${step.card}: divide is listed, but nothing was divided among ${step.divide.length} targets`;
  }
  return null;
}

/**
 * The actions that pay for a spell being cast or an ability being activated: `auto` activates what autoPay picks,
 * then pays; `{ R: 1 }` pays that from the pool; `cancel` cancels it; no `pay` leaves the payment decision pending.
 */
export function paymentActions(game: Game, step: StackStep, cards: CardDatabase): Action[] {
  const pending = game.state.pending;
  const player = step.player as PlayerId;
  if (step.pay === undefined || pending?.kind !== "payMana") return [];
  const decisionId = pending.id;
  if (step.pay === "cancel") return [{ type: "ANSWER", decisionId, player, answer: { kind: "cancelCast" } }];
  if (step.pay === "auto") {
    const plan = autoPay(game.state, player, pending.cost, cards);
    if (plan === null) throw new Error("pay: auto found no way to pay");
    return [
      ...plan.activations.map((a): Action => ({ type: "ACTIVATE_ABILITY", decisionId, player, ...a })),
      { type: "ANSWER", decisionId, player, answer: { kind: "payMana", payment: plan.payment } },
    ];
  }
  return [{ type: "ANSWER", decisionId, player, answer: { kind: "payMana", payment: paymentFrom(step.pay) } }];
}
