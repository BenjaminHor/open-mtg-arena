// Replacement and prevention effects made by resolving spells and abilities (CR 614.1, 615.1), kept until used or
// until they end. A card's own replacements are in its text instead (`CardDef.replacements`).

import type { GameState } from "./game-state.ts";
import type { ObjectId, OracleId, PlayerId } from "./ids.ts";

export type ReplacementEffect =
  /**
   * A regeneration shield on `object`: the next time it would be destroyed this turn, it's regenerated instead
   * (CR 701.19a, 614.8). Ends in the cleanup step if unused (CR 514.2).
   */
  | { kind: "regenerationShield"; object: ObjectId }
  /**
   * "Prevent all [combat] damage that would be dealt [to you and creatures you control] this turn" (Fog, Safe Passage;
   * CR 615.1a): checked as each damage event happens, so a creature arriving later is protected too (Safe Passage's
   * ruling). `id` is the spell that made it, which names it; `sourceOracleId` names it once that spell is gone.
   */
  | {
      kind: "preventAllDamage";
      id: ObjectId;
      sourceOracleId: OracleId;
      controller: PlayerId;
      combatOnly: boolean;
      protects: "everyone" | "controllerAndCreatures";
    };

/**
 * One replacement effect that would apply to an event, named so a player can choose it (CR 616.1) and so it applies
 * once (later: CR 614.5): a card's own replacement by its object and place in `replacementsOf` (stable while a choice waits), an
 * object's regeneration shields (interchangeable, so one reference stands for them all, D-086), or a prevention effect
 * in `GameState.replacements` by its id.
 */
export type ReplacementRef =
  | { kind: "ownText"; object: ObjectId; index: number }
  | { kind: "regenerationShield"; object: ObjectId }
  | { kind: "prevention"; id: ObjectId };

/**
 * A choice a player made between replacement effects, and what it was for: the object an event affects, or one damage
 * entry (a source dealing damage to a recipient), so a choice made for one isn't used for another (CR 616.1).
 */
export type ReplacementChoice = { for: string; ref: ReplacementRef };

export function sameReplacement(a: ReplacementRef, b: ReplacementRef): boolean {
  switch (a.kind) {
    case "ownText":
      return b.kind === "ownText" && a.object === b.object && a.index === b.index;
    case "regenerationShield":
      return b.kind === "regenerationShield" && a.object === b.object;
    case "prevention":
      return b.kind === "prevention" && a.id === b.id;
  }
}

/** Whether this permanent has a regeneration shield (CR 701.19a). */
export function hasRegenerationShield(state: GameState, object: ObjectId): boolean {
  return state.replacements.some((r) => r.kind === "regenerationShield" && r.object === object);
}

/** Every replacement effect ends in the cleanup step: all of them last "this turn" so far (CR 514.2). */
export function endReplacementEffects(state: GameState): GameState {
  return state.replacements.length === 0 ? state : { ...state, replacements: [] };
}
