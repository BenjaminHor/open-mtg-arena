// Reading loyalty (CR 306.5, 606.4): a planeswalker's loyalty on the battlefield is its loyalty counters, and a loyalty
// ability's cost is the loyalty symbol in its cost. The one place both are read, so effects that change loyalty costs
// (later: CR 606.4's "may be modified", 606.5) change one function.

import type { AbilityDef } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";

/** The loyalty counters on a permanent: its loyalty on the battlefield (CR 306.5c). */
export function loyaltyOf(state: GameState, id: ObjectId): number {
  const obj = state.objects[id];
  return obj?.kind === "card" ? (obj.counters.loyalty ?? 0) : 0;
}

/** Whether this is a loyalty ability: one with a loyalty symbol in its cost (CR 606.2), whatever the amount. */
export function isLoyaltyAbility(def: AbilityDef): boolean {
  return def.cost.some((p) => p.kind === "loyalty");
}

/**
 * The loyalty counters an ability's cost puts on its permanent, negative to remove ([+N], [−N], [0], CR 107.7); for
 * [−X], minus the X announced (`x`, 0 before it is). Null if it isn't a loyalty ability (CR 606.2). A definition has
 * at most one loyalty part (`definition-problems.ts`).
 */
export function loyaltyChange(def: AbilityDef, x: number | null): number | null {
  const part = def.cost.find((p) => p.kind === "loyalty");
  if (part?.kind !== "loyalty") return null;
  return part.amount === "minusX" ? -(x ?? 0) : part.amount;
}

/** Whether the ability's loyalty cost is [−X], so X is announced and bounded by the loyalty (CR 606.6). */
export function hasLoyaltyX(def: AbilityDef): boolean {
  return def.cost.some((p) => p.kind === "loyalty" && p.amount === "minusX");
}
