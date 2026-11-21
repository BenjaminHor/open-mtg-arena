// Whether an object fits a description such as "nonblack creature" or "tapped creature an opponent controls"
// (`ObjectFilter`, cards/types.ts). Targets use it (CR 115), and later costs ("sacrifice a Goblin") and effects ("each
// creature without flying") will too, so the restrictions are read in one place: `filter-fit.ts`, which the layer pass
// also uses for static abilities' sets (D-093). This file feeds it the object's characteristics now.

import type { CardDatabase, ObjectFilter } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { isAttacking, isBlocking } from "./combat.ts";
import { fits } from "./filter-fit.ts";
import { layeredOf } from "./layers.ts";

/**
 * Whether the card `id` fits every restriction in `filter`, read from its characteristics now (CR 109.3, 613), in any
 * zone (`filter-fit.ts`). `you` is the player the text calls "you": the controller of the spell or ability (CR 109.5);
 * `thatPlayer`, for a triggered ability's target, the player its event was about.
 */
export function matchesFilter(
  state: GameState,
  id: ObjectId,
  filter: ObjectFilter,
  you: PlayerId,
  cards: CardDatabase,
  thatPlayer: PlayerId | null = null,
): boolean {
  const obj = state.objects[id];
  const card = layeredOf(state, id, cards);
  if (obj?.kind !== "card" || card === null) return false;
  const controlled = state.zones.battlefield.includes(id) || state.zones.stack.includes(id);
  // The pass's controller is `controllerOf`'s (layer 2 is its own, D-092; the fuzzer checks they agree).
  const inCombat = (as: NonNullable<ObjectFilter["combat"]>) => inCombatAs(state, id, as, cards);
  return fits({ obj, card, controlled, inCombat }, filter, you, thatPlayer);
}

function inCombatAs(state: GameState, id: ObjectId, as: NonNullable<ObjectFilter["combat"]>, cards: CardDatabase) {
  switch (as) {
    case "attacking":
      return isAttacking(state, id, cards);
    case "blocking":
      return isBlocking(state, id, cards);
    case "attackingOrBlocking":
      return isAttacking(state, id, cards) || isBlocking(state, id, cards);
  }
}
