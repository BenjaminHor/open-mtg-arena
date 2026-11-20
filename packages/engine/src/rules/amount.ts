// The number an effect's `Amount` stands for: written on the card, X (CR 107.3a), or a count of permanents.

import type { Amount, ObjectFilter } from "../cards/types.ts";

/**
 * `x` is the value announced as the spell was cast or the ability activated (CR 107.3a, 601.2b). An amount of X with
 * nothing announced is a definition bug: a card whose text uses X has an X to announce.
 */
export function amountOf(amount: Amount, x: number | null, count?: (filter: ObjectFilter) => number): number {
  if (typeof amount === "number") return amount;
  if (amount !== "X") {
    // A count needs the battlefield; only resolving effects have one to count (CR 608.2h).
    if (count === undefined) throw new Error("a counted amount is only worked out as an effect applies");
    return count(amount.count);
  }
  if (x === null) throw new Error("X was never announced");
  return x;
}
