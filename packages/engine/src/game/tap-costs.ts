// {T} in the cost of an ability that uses the stack (CR 107.5, 602.5a). It's checked when the activation begins
// (`activationBasicsProblem`) and paid with the rest of the cost (`payCost`, CR 601.2h), after the targets are chosen:
// so Royal Assassin can't target itself (its ruling).

import type { CardDatabase } from "../cards/types.ts";
import { stackAbilityDef } from "../rules/abilities.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";

/**
 * The permanents the cost being paid taps: the ability's source when its cost has {T}. They can't also be tapped for
 * mana to pay it: a tapped permanent can't be tapped again for the cost (CR 107.5), so the cost couldn't be paid.
 */
export function tapsForCost(state: GameState, cards: CardDatabase): ObjectId[] {
  const casting = state.casting;
  if (casting === null || casting.origin.kind !== "ability") return [];
  const def = stackAbilityDef(state, casting.object, cards);
  return def.cost.some((part) => part.kind === "tap") ? [casting.origin.source] : [];
}
