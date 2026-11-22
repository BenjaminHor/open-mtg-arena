// Auto-tap (architecture.md, "Match host"): when a seat pays a cost, the host picks the mana sources with the engine's
// `autoPay` (D-034) and answers the payment, as Arena's auto-tap does. With auto-tap off, or no way to pay found, the
// player pays by hand (or cancels). The engine still checks every action, so the host can't pay wrongly.

import { type Action, autoPay, type CardDatabase, type GameState } from "@mtg/engine";

/**
 * The next action paying the pending cost: a mana ability to activate, or, once the mana is there, the payment; null
 * if no way to pay was found. One at a time: each activation leaves a new decision, and the plan is made again with the
 * mana it added.
 */
export function autoTapAction(state: GameState, cards: CardDatabase): Action | null {
  const pending = state.pending;
  if (pending?.kind !== "payMana") return null;
  const plan = autoPay(state, pending.player, pending.cost, cards);
  if (plan === null) return null;
  const { id: decisionId, player } = pending;
  const [activation] = plan.activations;
  if (activation !== undefined) return { type: "ACTIVATE_ABILITY", decisionId, player, ...activation };
  return { type: "ANSWER", decisionId, player, answer: { kind: "payMana", payment: plan.payment } };
}
