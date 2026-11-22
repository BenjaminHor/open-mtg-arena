// An object's card types (CR 205.2), for code that asks "is this a creature?", "is this an instant?".

import type { CardDatabase, CardType, Supertype } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import { layeredOf } from "./layers.ts";

/**
 * An object's subtypes (CR 205.3): layer 4 of `characteristics()`, with the effects that change them applied by the
 * layer pass (Awakener Druid's, a land type set by Convincing Mirage, CR 305.7).
 */
export function subtypesOf(state: GameState, id: ObjectId, cards: CardDatabase): readonly string[] {
  return layeredOf(state, id, cards)?.subtypes ?? [];
}

/**
 * An object's supertypes (CR 205.4): layer 4 of `characteristics()`, printed until type-changing effects exist.
 * The legend rule (CR 704.5j) asks this.
 */
export function supertypesOf(state: GameState, id: ObjectId, cards: CardDatabase): readonly Supertype[] {
  return layeredOf(state, id, cards)?.supertypes ?? [];
}

/**
 * The card types an object has now: layer 4 of `characteristics()`. Printed, since no type-changing effects exist
 * yet; when they do (layer 4), they change the answer here, in one place.
 */
export function cardTypesOf(state: GameState, id: ObjectId, cards: CardDatabase): readonly CardType[] {
  return layeredOf(state, id, cards)?.types ?? [];
}
