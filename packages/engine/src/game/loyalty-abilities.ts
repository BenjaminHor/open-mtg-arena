// Loyalty abilities (CR 606): activated abilities with a loyalty symbol in their cost, normally a planeswalker's.
// Their cost puts loyalty counters on the permanent or removes them (CR 606.4); they're activated only as a sorcery,
// once per turn for each permanent (CR 606.3), and a negative one only with enough counters (CR 606.6).

import type { AbilityDef, CardDatabase } from "../cards/types.ts";
import type { SingleEvent } from "../pipeline/proposed.ts";
import { abilitiesOf, stackAbilityDef } from "../rules/abilities.ts";
import { hasLoyaltyX, isLoyaltyAbility, loyaltyChange, loyaltyOf } from "../rules/loyalty.ts";
import { mainPhaseEmptyStack } from "../rules/timing.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { activationsThisTurn } from "./activation-count.ts";

/**
 * Why `player` can't activate this loyalty ability of `id` now, or null: only in their main phase with an empty stack,
 * and only if no loyalty ability of that permanent has been activated this turn (CR 606.3), counted per object, so a
 * permanent that left and came back is a new one with none (CR 400.7); a negative cost needs that many loyalty counters
 * (CR 606.6).
 */
export function loyaltyAbilityProblem(
  state: GameState,
  player: PlayerId,
  id: ObjectId,
  def: AbilityDef,
  cards: CardDatabase,
): string | null {
  if (!isLoyaltyAbility(def)) return null;
  if (!mainPhaseEmptyStack(state, player))
    return "a loyalty ability only in your main phase with an empty stack (CR 606.3)";
  const activated = abilitiesOf(state, id, cards).some(
    (a) => a.ref.kind === "printed" && isLoyaltyAbility(a.def) && activationsThisTurn(state, id, a.ref.index) > 0,
  );
  if (activated) return `a loyalty ability of ${id} has already been activated this turn (CR 606.3)`;
  // [−X] is checked once X is announced (`loyaltyXProblem`); X = 0 can always be paid.
  const cost = loyaltyChange(def, null) ?? 0;
  if (cost < 0 && loyaltyOf(state, id) < -cost)
    return `${id} has fewer than ${-cost} loyalty counters to remove (CR 606.6)`;
  return null;
}

/**
 * The loyalty part of the cost being paid, as the event that pays it: counters put on or removed from the ability's
 * source (CR 606.4), or null when the cost has none. A negative one can't be paid without enough counters, rechecked
 * as the whole cost is paid (CR 601.2h, 606.6): "unpayable" then. Nothing in the pool can remove the counters between
 * the start of an activation and its payment (no loyalty ability has a mana cost, so no mana ability runs between),
 * so this is a guard, not a path a game takes today.
 */
export function loyaltyPayment(state: GameState, cards: CardDatabase): SingleEvent | "unpayable" | null {
  const casting = state.casting;
  if (casting === null || casting.origin.kind !== "ability") return null;
  const x = state.objects[casting.object]?.choices?.x ?? null;
  const cost = loyaltyChange(stackAbilityDef(state, casting.object, cards), x);
  if (cost === null || cost === 0) return null;
  const object = casting.origin.source;
  if (!state.zones.battlefield.includes(object)) return "unpayable";
  if (cost > 0) return { kind: "putCounters", object, counter: "loyalty", amount: cost };
  if (loyaltyOf(state, object) < -cost) return "unpayable";
  return { kind: "removeCounters", object, counter: "loyalty", amount: -cost };
}

/**
 * Why X can't be this for the ability being activated, when its cost is [−X]: X can't be more than the loyalty
 * counters on the permanent (CR 606.6; Chandra Nalaar's ruling: "equal to or less than ... You may choose 0"). Null
 * otherwise. Checked as X is announced, so a too-large X is refused there, never paid.
 */
export function loyaltyXProblem(state: GameState, x: number, cards: CardDatabase): string | null {
  const most = loyaltyXMost(state, cards);
  return most === null || x <= most ? null : `X can be at most ${most}, the loyalty counters there are (CR 606.6)`;
}

/** The largest X a [−X] cost being activated can have, its permanent's loyalty; null if the cost has no [−X]. */
export function loyaltyXMost(state: GameState, cards: CardDatabase): number | null {
  const casting = state.casting;
  if (casting === null || casting.origin.kind !== "ability") return null;
  if (!hasLoyaltyX(stackAbilityDef(state, casting.object, cards))) return null;
  return loyaltyOf(state, casting.origin.source);
}
