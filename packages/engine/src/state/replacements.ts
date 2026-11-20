// Replacement effects made by resolving spells and abilities (CR 614.1), kept until used or until they end. A card's own
// replacements are in its text instead (`CardDef.replacements`).

import type { GameState } from "./game-state.ts";
import type { ObjectId } from "./ids.ts";

export type ReplacementEffect =
  /**
   * A regeneration shield on `object`: the next time it would be destroyed this turn, it's regenerated instead
   * (CR 701.19a, 614.8). Ends in the cleanup step if unused (CR 514.2).
   */
  { kind: "regenerationShield"; object: ObjectId };

/**
 * One replacement effect that would apply to an event, named so a player can choose it and so it's applied once
 * (CR 616.1; later: CR 614.5): a card's own replacement by its object and place in `CardDef.replacements`, or an object's
 * regeneration shields (interchangeable, so one reference stands for them all, D-086).
 */
export type ReplacementRef =
  | { kind: "ownText"; object: ObjectId; index: number }
  | { kind: "regenerationShield"; object: ObjectId };

export function sameReplacement(a: ReplacementRef, b: ReplacementRef): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Whether this permanent has a regeneration shield (CR 701.19a). */
export function hasRegenerationShield(state: GameState, object: ObjectId): boolean {
  return state.replacements.some((r) => r.kind === "regenerationShield" && r.object === object);
}

/** Every replacement effect ends in the cleanup step: all of them last "this turn" so far (CR 514.2). */
export function endReplacementEffects(state: GameState): GameState {
  return state.replacements.length === 0 ? state : { ...state, replacements: [] };
}
