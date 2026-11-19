// The "summoning sickness" rule (CR 302.6, 602.5a) for {T} abilities, with haste (CR 702.10c). Attacking has the same
// rule, in `rules/combat.ts` (`canAttack`).

import type { CardDatabase } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import { keywordsOf } from "./abilities.ts";
import { cardTypesOf } from "./card-types.ts";

/**
 * Whether a permanent's {T} abilities can be activated as far as this rule goes: a creature must have been under its
 * controller's control continuously since their most recent turn began (CR 602.5a). The rule is only about creatures,
 * so a land that just entered can tap for mana.
 */
export function canUseTapAbilities(state: GameState, id: ObjectId, cards: CardDatabase): boolean {
  if (!cardTypesOf(state, id, cards).includes("creature")) return state.objects[id]?.kind === "card";
  return isFreeOfSummoningSickness(state, id, cards);
}

/**
 * The summoning sickness rule itself, for attacking (CR 302.6) and {T} abilities (CR 602.5a): the creature has been
 * under its controller's control continuously since their most recent turn began, or it has haste (CR 702.10b–c).
 */
export function isFreeOfSummoningSickness(state: GameState, id: ObjectId, cards: CardDatabase): boolean {
  const obj = state.objects[id];
  if (obj?.kind !== "card") return false;
  return obj.controlledSinceTurnStart || keywordsOf(state, id, cards).includes("haste");
}
