// {T} in the cost of an ability that uses the stack (CR 107.5, 602.5a). It's checked when the activation begins
// (`activationBasicsProblem`) and paid with the rest of the cost (`payCost`, CR 601.2h), after the targets are chosen:
// so Royal Assassin can't target itself (its ruling).

import type { CardDatabase } from "../cards/types.ts";
import { stackAbilityDef } from "../rules/abilities.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";

/**
 * The permanents the cost being paid taps: the ability's source when its cost has {T}. Tapping one for mana meanwhile
 * is allowed (CR 605.3a), but then the cost can't be paid (CR 107.5, 601.2h), so `autoPay` doesn't propose it.
 */
export function tapsForCost(state: GameState, cards: CardDatabase): ObjectId[] {
  const casting = state.casting;
  if (casting === null || casting.origin.kind !== "ability") return [];
  const def = stackAbilityDef(state, casting.object, cards);
  return def.cost.some((part) => part.kind === "tap") ? [casting.origin.source] : [];
}

/** Whether this permanent can still be tapped to pay the cost: on the battlefield and untapped (CR 107.5). */
export function canTapForCost(state: GameState, id: ObjectId): boolean {
  const obj = state.objects[id];
  return obj?.kind === "card" && state.zones.battlefield.includes(id) && !obj.tapped;
}
