// The number an effect's `Amount` stands for: written on the card, or X (CR 107.3a).

import type { Amount } from "../cards/types.ts";

/**
 * `x` is the value announced as the spell was cast or the ability activated (CR 107.3a, 601.2b). An amount of X with
 * nothing announced is a definition bug: a card whose text uses X has an X to announce.
 */
export function amountOf(amount: Amount, x: number | null): number {
  if (amount !== "X") return amount;
  if (x === null) throw new Error("X was never announced");
  return x;
}
