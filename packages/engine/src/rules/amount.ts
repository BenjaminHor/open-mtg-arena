// The number a fixed `Amount` stands for: written on the card, or X as announced (CR 107.3a). A count of permanents
// and a trigger's "that much" are worked out only as an effect applies, by `amountNow` (effects/subjects.ts).

import type { Amount } from "../cards/types.ts";

/** An amount that needs no game to work out: a number, or X. */
export type FixedAmount = Extract<Amount, number | "X">;

/** Whether the amount is known before resolution: a number or X, as a divided amount must be (CR 601.2d). */
export function isFixedAmount(amount: Amount): amount is FixedAmount {
  return typeof amount === "number" || amount === "X";
}

/**
 * `x` is the value announced as the spell was cast or the ability activated (CR 107.3a, 601.2b). An amount of X with
 * nothing announced is a definition bug: a card whose text uses X has an X to announce.
 */
export function amountOf(amount: FixedAmount, x: number | null): number {
  if (typeof amount === "number") return amount;
  if (x === null) throw new Error("X was never announced");
  return x;
}
