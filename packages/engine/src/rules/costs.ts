// What it costs to cast a spell or activate an ability, in one place each, so cost increases, reductions and
// additional costs (CR 601.2f) have one function to change.

import type { AbilityDef, CardDatabase, ManaCost } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";

/**
 * The total cost of a spell (CR 601.2f): its mana cost, plus additional costs and increases, minus reductions. There
 * are none of those yet, so it's the printed mana cost. Null when the card has no mana cost (CR 118.6).
 */
export function totalCost(state: GameState, id: ObjectId, cards: CardDatabase): ManaCost | null {
  const obj = state.objects[id];
  return obj?.kind === "card" ? (cards[obj.oracleId]?.printed.manaCost ?? null) : null;
}

/** An ability's activation cost in mana (CR 602.1a), its analog of a spell's mana cost (CR 602.2b). */
export function activationManaCost(def: AbilityDef): ManaCost {
  return def.cost.flatMap((part) => (part.kind === "mana" ? part.cost : []));
}
