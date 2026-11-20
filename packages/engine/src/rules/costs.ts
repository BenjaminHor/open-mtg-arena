// What it costs to cast a spell or activate an ability, in one place each, so cost increases, reductions and
// additional costs (CR 601.2f) have one function to change.

import type { AbilityDef, CardDatabase, ManaCost } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import { stackAbilityDef } from "./abilities.ts";

/**
 * The total cost of a spell (CR 601.2f): its mana cost with X as the announced amount of generic mana (CR 107.3a), plus
 * increases (Fireball's, for each target beyond the first), additional costs and minus reductions (none yet). Worked out
 * from the choices made so far; before they're made, X is 0 and there are no targets. Null when the card has no mana
 * cost (CR 118.6).
 */
export function totalCost(state: GameState, id: ObjectId, cards: CardDatabase): ManaCost | null {
  const obj = state.objects[id];
  if (obj?.kind !== "card") return null;
  const data = cards[obj.oracleId];
  const printed = data?.printed.manaCost ?? null;
  if (printed === null) return null;
  const x = obj.choices?.x ?? 0;
  const cost = withX(printed, x);
  const increase = data?.def.spell?.costIncrease;
  if (increase === undefined) return cost;
  const targets = (obj.choices?.targets ?? []).reduce((n, group) => n + group.length, 0);
  const extra = Math.max(0, targets - 1);
  return [...cost, ...Array.from({ length: extra }, () => increase.perTargetBeyondFirst).flat()];
}

/** A cost with each {X} as `x` generic mana (CR 107.3a), so it can be paid; {X} with X = 0 is no mana at all. */
export function withX(cost: ManaCost, x: number): ManaCost {
  return cost.flatMap((symbol) =>
    symbol.kind === "x" ? (x > 0 ? [{ kind: "generic" as const, amount: x }] : []) : [symbol],
  );
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
      return withX(activationManaCost(stackAbilityDef(state, id, cards)), obj.choices.x ?? 0);
  }
}

/** Whether this spell or ability has an X in its cost for its controller to announce (CR 107.3a, 601.2b). */
export function announcesX(state: GameState, id: ObjectId, cards: CardDatabase): boolean {
  const obj = state.objects[id];
  if (obj === undefined) return false;
  switch (obj.kind) {
    case "card":
      return hasX(cards[obj.oracleId]?.printed.manaCost ?? null);
    case "ability":
      return hasX(activationManaCost(stackAbilityDef(state, id, cards)));
  }
}
