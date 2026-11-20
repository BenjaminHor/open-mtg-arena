// The part `cast` and `activate` share (docs/testing.md, "Steps"): after the spell or ability is put on the stack, its
// targets in order, any division, then the payment (CR 601.2c–h, 602.2b).

import { type Action, type Answer, autoPay, type CardDatabase, type GameState, type PlayerId } from "@mtg/engine";
import { type AfterEach, apply, type Game, legal } from "./apply.ts";
import { deepEqual } from "./compare.ts";
import type { ScenarioStep } from "./format.ts";
import { paymentFrom, targetNamed } from "./lookups.ts";

export type StackStep = Extract<ScenarioStep, { kind: "cast" | "activate" }>;

/**
 * Chooses the listed targets (and how many, for an instance that takes a range), then divides as `divide` says, then
 * pays as `pay` says. With no targets listed it may stop at the first target choice; with some listed, they must all be
 * there. Without `pay` it stops at the payment decision.
 */
export function targetsAndPayment(game: Game, step: StackStep, cards: CardDatabase, afterEach: AfterEach): Game {
  let next = game;
  for (
    let answer = stackAnswer(next.state, step, cards);
    answer !== null;
    answer = stackAnswer(next.state, step, cards)
  ) {
    const wanted = answer;
    const action = legal(
      next,
      step.player,
      cards,
      (a) => a.type === "ANSWER" && deepEqual(a.answer, wanted),
      answerText(wanted),
    );
    next = apply(next, action, cards, afterEach);
  }
  const pending = next.state.pending?.kind;
  if (step.targets.length > 0 && (pending === "chooseTarget" || pending === "chooseTargetCount")) {
    throw new Error(`${step.kind} ${step.card}: it needs more targets than the ${step.targets.length} listed`);
  }
  if (step.divide !== null && pending === "divide") {
    throw new Error(`${step.kind} ${step.card}: it needs more shares than the ${step.divide.length} listed`);
  }
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
 * The answer this step gives the pending decision about targets or a division, or null when it has none: how many
 * targets an instance has (its list's length, or one), the next listed target, the next share.
 */
export function stackAnswer(state: GameState, step: StackStep, cards: CardDatabase): Answer | null {
  const pending = state.pending;
  if (pending === null) return null;
  switch (pending.kind) {
    case "chooseTargetCount": {
      const listed = step.targets[pending.instance];
      if (listed === undefined) return null;
      return { kind: "chooseTargetCount", count: Array.isArray(listed) ? listed.length : 1 };
    }
    case "chooseTarget": {
      const listed = step.targets[pending.instance];
      if (listed === undefined) return null;
      const names: unknown[] = Array.isArray(listed) ? listed : [listed];
      const chosen = state.objects[pending.object]?.choices?.targets[pending.instance]?.length ?? 0;
      const name = names[chosen];
      return name === undefined ? null : { kind: "chooseTarget", target: targetNamed(state, name, cards) };
    }
    case "divide": {
      const amount = step.divide?.[pending.shares.length];
      return amount === undefined ? null : { kind: "divide", amount };
    }
    default:
      return null;
  }
}

function answerText(answer: Answer): string {
  switch (answer.kind) {
    case "chooseTargetCount":
      return `${answer.count} targets`;
    case "chooseTarget":
      return `target ${answer.target.kind === "player" ? answer.target.player : answer.target.object}`;
    case "divide":
      return `a share of ${answer.amount}`;
    default:
      return answer.kind;
  }
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
      ...plan.activations.map(
        (a) => ({ type: "ACTIVATE_ABILITY", decisionId, player, object: a.object, ability: a.ability }) as const,
      ),
      { type: "ANSWER", decisionId, player, answer: { kind: "payMana", payment: plan.payment } },
    ];
  }
  return [{ type: "ANSWER", decisionId, player, answer: { kind: "payMana", payment: paymentFrom(step.pay) } }];
}
