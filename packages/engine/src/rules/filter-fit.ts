// Whether one object's characteristics fit an `ObjectFilter` ("nonblack creature", "Soldier creature you control"):
// the one place each restriction is read. `matchesFilter` (object-filter.ts) asks it with the finished layer pass;
// the pass itself asks it with the board as built so far (static-effects.ts), which is why this file reads no reader
// and imports only types.

import type { ObjectFilter } from "../cards/types.ts";
import type { PlayerId } from "../state/ids.ts";
import type { CardObject } from "../state/objects.ts";
import type { Layered } from "./layers.ts";

/** What a filter is checked against: the object, its characteristics, and the facts the characteristics don't hold. */
export type FitContext = {
  obj: CardObject;
  card: Layered;
  /** On the battlefield or the stack: only those have a controller (CR 109.4); a card elsewhere is controlled by no one. */
  controlled: boolean;
  /** Its place in combat, as `ObjectFilter.combat` names it; the pass can't ask, as combat isn't among its inputs. */
  inCombat: (as: NonNullable<ObjectFilter["combat"]>) => boolean;
  /**
   * Whether it has the card name chosen while this resolves (Sphinx Ambassador): only `matchesFilter` can say, as the
   * pass holds no name and no resolution.
   */
  namedThisWay: () => boolean;
};

/**
 * Whether the object fits every restriction in `filter` (CR 109.3). `you` is the player the text calls "you" (CR 109.5);
 * `thatPlayer`, for a triggered ability's target, the player its event was about.
 */
export function fits(object: FitContext, filter: ObjectFilter, you: PlayerId, thatPlayer: PlayerId | null): boolean {
  const { obj, card } = object;
  if (!anyOf(card.types, filter.types) || !noneOf(card.types, filter.notTypes)) return false;
  // "Nonblack" holds for a colorless object, which has no color (CR 105.2c).
  if (!anyOf(card.colors, filter.colors) || !noneOf(card.colors, filter.notColors)) return false;
  if (!anyOf(card.subtypes, filter.subtypes)) return false;
  // "With flying" / "without flying": keyword abilities as computed (CR 702.9a), granted ones too (layer 6).
  if (!anyOf(card.keywords, filter.keywords) || !noneOf(card.keywords, filter.notKeywords)) return false;
  // "Basic land card": every supertype listed (CR 205.4a), as computed.
  if (filter.supertypes !== undefined && !filter.supertypes.every((s) => card.supertypes.includes(s))) return false;
  // "Other than basic land cards": not fitting the whole inner filter, so a nonbasic land still fits.
  if (filter.not !== undefined && fits(object, filter.not, you, thatPlayer)) return false;
  if (filter.tapped === true && !obj.tapped) return false;
  if (filter.combat !== undefined && !object.inCombat(filter.combat)) return false;
  // "That doesn't have that name" (CR 201.4: the name chosen this way).
  if (filter.notNamedThisWay === true && object.namedThisWay()) return false;
  if (filter.controller !== undefined) {
    // Only permanents and spells have a controller (CR 109.4), even though `controllerOf` names a card's owner for
    // questions that need someone.
    if (!object.controlled || !controlledAs(card.controller, filter.controller, you, thatPlayer)) return false;
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
