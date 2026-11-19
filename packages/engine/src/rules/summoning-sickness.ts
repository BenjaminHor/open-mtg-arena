// The "summoning sickness" rule (CR 302.6, 602.5a), in one place, so haste (CR 702.10, M1-13) plugs in here.

import type { CardDatabase } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import { cardTypesOf } from "./card-types.ts";

/**
 * Whether a permanent's {T} abilities can be activated as far as this rule goes: a creature must have been under its
 * controller's control continuously since their most recent turn began (CR 602.5a). The rule is only about creatures,
 * so a land that just entered can tap for mana.
 */
export function canUseTapAbilities(state: GameState, id: ObjectId, cards: CardDatabase): boolean {
  const obj = state.objects[id];
  if (obj?.kind !== "card") return false;
  if (!cardTypesOf(state, id, cards).includes("creature")) return true;
  return obj.controlledSinceTurnStart;
}
