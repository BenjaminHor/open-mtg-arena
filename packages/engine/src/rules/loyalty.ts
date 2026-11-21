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

/**
 * The loyalty counters an ability's cost puts on its permanent, negative to remove ([+N], [−N], [0], CR 107.7); null
 * if it isn't a loyalty ability (CR 606.2). A definition has at most one loyalty part (`definition-problems.ts`).
 */
export function loyaltyCost(def: AbilityDef): number | null {
  const part = def.cost.find((p) => p.kind === "loyalty");
  return part?.kind === "loyalty" ? part.amount : null;
}
