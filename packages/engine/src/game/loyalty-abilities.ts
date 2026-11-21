// Loyalty abilities (CR 606): activated abilities with a loyalty symbol in their cost, normally a planeswalker's.
// Their cost puts loyalty counters on the permanent or removes them (CR 606.4); they're activated only as a sorcery,
// once per turn for each permanent (CR 606.3), and a negative one only with enough counters (CR 606.6).

import type { AbilityDef, CardDatabase } from "../cards/types.ts";
import type { SingleEvent } from "../pipeline/proposed.ts";
import { abilitiesOf, stackAbilityDef } from "../rules/abilities.ts";
import { mainPhaseEmptyStack } from "../rules/timing.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { activationsThisTurn } from "./activation-count.ts";

/** The loyalty counters an ability's cost puts on its permanent, negative to remove; null if it isn't a loyalty ability. */
export function loyaltyCost(def: AbilityDef): number | null {
  const part = def.cost.find((p) => p.kind === "loyalty");
  return part?.kind === "loyalty" ? part.amount : null;
}

/** The loyalty counters on a permanent: its loyalty on the battlefield (CR 306.5c). */
export function loyaltyOf(state: GameState, id: ObjectId): number {
  const obj = state.objects[id];
  return obj?.kind === "card" ? (obj.counters.loyalty ?? 0) : 0;
}

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
  const cost = loyaltyCost(def);
  if (cost === null) return null;
  if (!mainPhaseEmptyStack(state, player))
    return "a loyalty ability only in your main phase with an empty stack (CR 606.3)";
  const activated = abilitiesOf(state, id, cards).some(
    (a) => a.ref.kind === "printed" && loyaltyCost(a.def) !== null && activationsThisTurn(state, id, a.ref.index) > 0,
  );
  if (activated) return `a loyalty ability of ${id} has already been activated this turn (CR 606.3)`;
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
  const cost = loyaltyCost(stackAbilityDef(state, casting.object, cards));
  if (cost === null || cost === 0) return null;
  const object = casting.origin.source;
  if (!state.zones.battlefield.includes(object)) return "unpayable";
  if (cost > 0) return { kind: "putCounters", object, counter: "loyalty", amount: cost };
  if (loyaltyOf(state, object) < -cost) return "unpayable";
  return { kind: "removeCounters", object, counter: "loyalty", amount: -cost };
}
