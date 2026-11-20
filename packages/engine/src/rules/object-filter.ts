// Whether an object fits a description such as "nonblack creature" or "tapped creature an opponent controls"
// (`ObjectFilter`, cards/types.ts). Targets use it (CR 115), and later costs ("sacrifice a Goblin") and effects ("each
// creature without flying") will too, so the restrictions are read in one place.

import type { CardDatabase, ObjectFilter } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { keywordsOf } from "./abilities.ts";
import { cardTypesOf, subtypesOf, supertypesOf } from "./card-types.ts";
import { colorsOf } from "./colors.ts";
import { isAttacking, isBlocking } from "./combat.ts";
import { controllerOf } from "./controller.ts";

/**
 * Whether the card `id` fits every restriction in `filter`, read from its characteristics now (CR 109.3, 613), in any
 * zone. `you` is the player the text calls "you": the controller of the spell or ability (CR 109.5); `thatPlayer`, for a
 * triggered ability's target, the player its event was about. Each restriction asks only the layer reader it needs, as
 * `characteristics()` would compute power and toughness too.
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
  if (obj?.kind !== "card") return false;
  if (filter.types !== undefined || filter.notTypes !== undefined) {
    const types = cardTypesOf(state, id, cards);
    if (!anyOf(types, filter.types) || !noneOf(types, filter.notTypes)) return false;
  }
  if (filter.colors !== undefined || filter.notColors !== undefined) {
    // "Nonblack" holds for a colorless object, which has no color (CR 105.2c).
    const colors = colorsOf(state, id, cards);
    if (!anyOf(colors, filter.colors) || !noneOf(colors, filter.notColors)) return false;
  }
  if (filter.subtypes !== undefined && !anyOf(subtypesOf(state, id, cards), filter.subtypes)) return false;
  // "With flying" / "without flying": keyword abilities as computed now (CR 702.9a; layer 6, later: CR 613.1f).
  if (filter.keywords !== undefined || filter.notKeywords !== undefined) {
    const keywords = keywordsOf(state, id, cards);
    if (!anyOf(keywords, filter.keywords) || !noneOf(keywords, filter.notKeywords)) return false;
  }
  // "Basic land card": every supertype listed (CR 205.4a), as computed.
  if (filter.supertypes !== undefined) {
    const supertypes = supertypesOf(state, id, cards);
    if (!filter.supertypes.every((s) => supertypes.includes(s))) return false;
  }
  // "Other than basic land cards": not fitting the whole inner filter, so a nonbasic land still fits.
  if (filter.not !== undefined && matchesFilter(state, id, filter.not, you, cards, thatPlayer)) return false;
  if (filter.tapped === true && !obj.tapped) return false;
  if (filter.combat !== undefined && !inCombatAs(state, id, filter.combat, cards)) return false;
  if (filter.controller !== undefined) {
    // Only permanents and spells have a controller; a card in any other zone has none, so it's controlled by no one
    // (CR 109.4), even though `controllerOf` names its owner for questions that need someone.
    const controlled = state.zones.battlefield.includes(id) || state.zones.stack.includes(id);
    if (!controlled || !controlledAs(controllerOf(state, id), filter.controller, you, thatPlayer)) return false;
  }
  return true;
}

/** Whether `have` includes any of `wanted`; true when there's no such restriction. */
function anyOf<T>(have: readonly T[], wanted: readonly T[] | undefined): boolean {
  return wanted === undefined || wanted.some((w) => have.includes(w));
}

/** Whether `have` includes none of `unwanted`; true when there's no such restriction. */
function noneOf<T>(have: readonly T[], unwanted: readonly T[] | undefined): boolean {
  return unwanted === undefined || !unwanted.some((u) => have.includes(u));
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

/**
 * "You control", "you don't control", "an opponent controls". In a two-player game the opponent is the other player
 * (CR 102.2), so "an opponent" and "not you" agree; they differ once teams exist (later: CR 102.3).
 */
function controlledAs(
  controller: PlayerId,
  as: NonNullable<ObjectFilter["controller"]>,
  you: PlayerId,
  thatPlayer: PlayerId | null,
): boolean {
  switch (as) {
    case "you":
      return controller === you;
    case "notYou":
      return controller !== you;
    case "opponent":
      return controller !== you;
    case "triggeringPlayer":
      return controller === thatPlayer;
  }
}
