// Auto-tap (architecture.md, "Match host"): when a seat pays a cost, the host picks the mana sources with the engine's
// `autoPay` (D-034) and answers the payment, as Arena's auto-tap does. With auto-tap off, or no way to pay found, the
// player pays by hand (or cancels). The engine still checks every action, so the host can't pay wrongly.

import { type Action, autoPay, type CardDatabase, type GameState } from "@mtg/engine";

/** The actions that pay the pending cost: the mana abilities to activate, then the payment; null if none was found. */
export function autoTapActions(state: GameState, cards: CardDatabase): Action[] | null {
  const pending = state.pending;
  if (pending?.kind !== "payMana") return null;
  const plan = autoPay(state, pending.player, pending.cost, cards);
  if (plan === null) return null;
  const { id: decisionId, player } = pending;
  return [
    ...plan.activations.map((a): Action => ({ type: "ACTIVATE_ABILITY", decisionId, player, ...a })),
    { type: "ANSWER", decisionId, player, answer: { kind: "payMana", payment: plan.payment } },
  ];
}
