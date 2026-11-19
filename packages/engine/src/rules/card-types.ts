// An object's card types (CR 205.2), for code that asks "is this a creature?", "is this an instant?".

import type { CardDatabase, CardType, Supertype } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";

/**
 * An object's subtypes (CR 205.3): layer 4 of `characteristics()`. Printed, since no type-changing effects exist yet;
 * when they do (layer 4, such as CR 305.7), they change the answer here.
 */
export function subtypesOf(state: GameState, id: ObjectId, cards: CardDatabase): readonly string[] {
  const obj = state.objects[id];
  if (obj?.kind !== "card") return [];
  return cards[obj.oracleId]?.printed.subtypes ?? [];
}

/**
 * An object's supertypes (CR 205.4): layer 4 of `characteristics()`, printed until type-changing effects exist.
 * The legend rule (CR 704.5j) asks this.
 */
export function supertypesOf(state: GameState, id: ObjectId, cards: CardDatabase): readonly Supertype[] {
  const obj = state.objects[id];
  if (obj?.kind !== "card") return [];
  return cards[obj.oracleId]?.printed.supertypes ?? [];
}

/**
 * The card types an object has now: layer 4 of `characteristics()`. Printed, since no type-changing effects exist
 * yet; when they do (layer 4), they change the answer here, in one place.
 */
export function cardTypesOf(state: GameState, id: ObjectId, cards: CardDatabase): readonly CardType[] {
  const obj = state.objects[id];
  if (obj?.kind !== "card") return [];
  const data = cards[obj.oracleId];
  if (data === undefined) throw new Error(`No card data for ${obj.oracleId}`);
  return data.printed.types;
}
