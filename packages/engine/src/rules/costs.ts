// What it costs to cast a spell or activate an ability, in one place each, so cost increases, reductions and
// additional costs (CR 601.2f) have one function to change.

import { cardDataOf } from "../cards/card-data.ts";
import type { AbilityDef, CardDatabase, Color, ManaCost } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import { isTriggerRef, stackAbilityDef } from "./abilities.ts";
import { hasLoyaltyX } from "./loyalty.ts";

/**
 * The total cost of a spell (CR 601.2f): its mana cost with X as the announced amount of generic mana (CR 107.3a), plus
 * increases (Fireball's, for each target beyond the first), additional costs and minus reductions (none yet). Worked out
 * from the choices made so far; before they're made, X is 0 and there are no targets. Null when the card has no mana
 * cost (CR 118.6).
 */
export function totalCost(state: GameState, id: ObjectId, cards: CardDatabase): ManaCost | null {
  const obj = state.objects[id];
  if (obj?.kind !== "card") return null;
  const data = cardDataOf(obj, cards);
  const printed = data?.printed.manaCost ?? null;
  if (printed === null) return null;
  const x = obj.choices?.x ?? 0;
  return [...withX(printed, x, data?.def.spell?.xPaidWith), ...costIncreases(state, id, cards)];
}

/**
 * A spell's cost increases: Fireball's "{1} more for each target beyond the first" (CR 601.2f). Also all that's paid
 * for a spell cast "without paying its mana cost", an alternative cost of nothing, to which they still apply (CR 118.9d).
 */
export function costIncreases(state: GameState, id: ObjectId, cards: CardDatabase): ManaCost {
  const obj = state.objects[id];
  if (obj?.kind !== "card") return [];
  const increase = cardDataOf(obj, cards)?.def.spell?.costIncrease;
  if (increase === undefined) return [];
  const targets = (obj.choices?.targets ?? []).reduce((n, group) => n + group.length, 0);
  const extra = Math.max(0, targets - 1);
  return Array.from({ length: extra }, () => increase.perTargetBeyondFirst).flat();
}

/**
 * A cost with each {X} as `x` generic mana (CR 107.3a), so it can be paid; {X} with X = 0 is no mana at all. With
 * `paidWith` ("Spend only black mana on X"), each X is one mana of that color instead: the same payments are legal
 * (CR 601.2h), and the printed cost is untouched.
 */
export function withX(cost: ManaCost, x: number, paidWith?: Color): ManaCost {
  return cost.flatMap((symbol): ManaCost => {
    if (symbol.kind !== "x") return [symbol];
    if (paidWith !== undefined) return Array.from({ length: x }, () => ({ kind: "colored", color: paidWith }) as const);
    return x > 0 ? [{ kind: "generic", amount: x }] : [];
  });
}

/** Whether a mana cost has an {X} the caster announces (CR 107.3a). */
function hasX(cost: ManaCost | null): boolean {
  return (cost ?? []).some((symbol) => symbol.kind === "x");
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
      // A triggered ability has no cost to pay as it's put on the stack (CR 603.3d).
      if (isTriggerRef(obj.ability)) return [];
      return withX(activationManaCost(stackAbilityDef(state, id, cards)), obj.choices.x ?? 0);
  }
}

/** Whether this spell or ability has an X in its cost for its controller to announce (CR 107.3a, 601.2b). */
export function announcesX(state: GameState, id: ObjectId, cards: CardDatabase): boolean {
  const obj = state.objects[id];
  if (obj === undefined) return false;
  switch (obj.kind) {
    case "card":
      return hasX(cardDataOf(obj, cards)?.printed.manaCost ?? null);
    case "ability": {
      if (isTriggerRef(obj.ability)) return false;
      // {X} in the mana, or [−X] in the loyalty cost (CR 107.3a, 606.4).
      const def = stackAbilityDef(state, id, cards);
      return hasX(activationManaCost(def)) || hasLoyaltyX(def);
    }
  }
}
