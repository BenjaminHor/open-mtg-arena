// What it costs to cast a spell or activate an ability, in one place each, so cost increases, reductions and
// additional costs (CR 601.2f) have one function to change.

import type { AbilityDef, CardDatabase, ManaCost } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import { stackAbilityDef } from "./abilities.ts";

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

/**
 * The mana to pay to put this spell or ability on the stack: a spell's total cost (CR 601.2f), or an ability's activation
 * cost (CR 602.2b). Every reader of that cost asks here. A spell with no mana cost has an unpayable cost (CR 118.6);
 * casting refuses it before it gets this far.
 */
export function costOf(state: GameState, id: ObjectId, cards: CardDatabase): ManaCost {
  const obj = state.objects[id];
  if (obj === undefined) throw new Error(`No object ${id}`);
  switch (obj.kind) {
    case "card": {
      const cost = totalCost(state, id, cards);
      if (cost === null) throw new Error("A spell with no mana cost can't be paid for (CR 118.6)");
      return cost;
    }
    case "ability":
      return activationManaCost(stackAbilityDef(state, id, cards));
  }
}
