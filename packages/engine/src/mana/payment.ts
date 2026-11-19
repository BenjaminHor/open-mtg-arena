// Paying a mana cost from a mana pool (CR 601.2h, 107.4). Which mana pays is the player's choice, so a payment is data
// the engine checks: how much of each type of mana is spent.

import type { ManaCost } from "../cards/types.ts";
import { MANA_TYPES, type ManaPool, type ManaType } from "../state/mana.ts";

/** How much of each type of mana a payment spends. */
export type ManaPayment = ManaPool;

/**
 * Spends `payment` from `pool` to pay `cost`, or returns null if it can't: the pool must hold the mana, each colored
 * symbol needs mana of its color (CR 107.4a), generic can be paid with any type (CR 107.4b), and the payment must be
 * exactly the cost. All or nothing: a payment that doesn't work leaves the pool as it was (CR 601.2h).
 */
export function payFromPool(pool: ManaPool, cost: ManaCost, payment: ManaPayment): ManaPool | null {
  let generic = 0;
  const colored: Record<ManaType, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const symbol of cost) {
    if (symbol.kind === "generic") generic += symbol.amount;
    else colored[symbol.color] += 1;
  }
  let spare = 0;
  for (const type of MANA_TYPES) {
    const paid = payment[type];
    if (!Number.isInteger(paid) || paid < 0 || paid > pool[type]) return null;
    if (paid < colored[type]) return null;
    spare += paid - colored[type];
  }
  if (spare !== generic) return null;
  const rest = { ...pool };
  for (const type of MANA_TYPES) rest[type] = pool[type] - payment[type];
  return rest;
}

/** The total mana in a cost: its mana value (CR 202.3). */
export function manaValue(cost: ManaCost | null): number {
  return (cost ?? []).reduce((sum, s) => sum + (s.kind === "generic" ? s.amount : 1), 0);
}

/**
 * Every payment from `pool` that pays `cost` exactly, in a fixed order. Which mana pays is the player's choice
 * (CR 601.2h), so `legalActions` lists them all. Pools are small (a few mana), so listing every split is cheap.
 */
export function allPayments(pool: ManaPool, cost: ManaCost): ManaPayment[] {
  const payments: ManaPayment[] = [];
  const current: ManaPayment = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const choose = (i: number) => {
    const type = MANA_TYPES[i];
    if (type === undefined) {
      if (payFromPool(pool, cost, current) !== null) payments.push({ ...current });
      return;
    }
    for (let n = 0; n <= pool[type]; n++) {
      current[type] = n;
      choose(i + 1);
    }
    current[type] = 0;
  };
  choose(0);
  return payments;
}
