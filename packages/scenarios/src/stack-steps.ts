// The part `cast` and `activate` share (docs/testing.md, "Steps"): after the spell or ability is put on the stack, its
// targets in order, then the payment (CR 601.2c–h, 602.2b).

import { type Action, autoPay, type CardDatabase, type GameState, type PlayerId } from "@mtg/engine";
import { apply, type Game, legal } from "./apply.ts";
import { deepEqual } from "./compare.ts";
import type { ScenarioStep } from "./format.ts";
import { paymentFrom, targetNamed } from "./lookups.ts";

export type StackStep = Extract<ScenarioStep, { kind: "cast" | "activate" }>;

/**
 * Chooses the listed targets, then pays as `pay` says. With no targets listed it may stop at the first target choice;
 * with some listed, they must all be there. Without `pay` it stops at the payment decision.
 */
export function targetsAndPayment(
  game: Game,
  step: StackStep,
  cards: CardDatabase,
  afterEach: (g: Game) => void,
): Game {
  let next = game;
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
  if (step.targets.length > 0 && next.state.pending?.kind === "chooseTarget") {
    throw new Error(`${step.kind} ${step.card}: it needs more targets than the ${step.targets.length} listed`);
  }
  if (step.pay !== undefined && next.state.pending?.kind !== "payMana") {
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

/** The i-th action's target answer (i from 1, after the cast or activation itself), or null after the last. */
export function targetAction(state: GameState, step: StackStep, cards: CardDatabase, i: number): Action | null {
  const target = step.targets[i - 1];
  if (target === undefined) return null;
  const decisionId = state.pending?.id ?? "d0";
  return {
    type: "ANSWER",
    decisionId,
    player: step.player as PlayerId,
    answer: { kind: "chooseTarget", target: targetNamed(state, target, cards) },
  };
}

/**
 * The actions that pay for a spell being cast or an ability being activated: `auto` activates what autoPay picks, then pays; `{ R: 1 }` pays that from
 * the pool; `cancel` cancels it; no `pay` leaves the payment decision pending.
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
