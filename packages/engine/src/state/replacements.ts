// Replacement and prevention effects made by resolving spells and abilities (CR 614.1, 615.1), kept until used or
// until they end. A card's own replacements are in its text instead (`CardDef.replacements`).

import type { GameState } from "./game-state.ts";
import type { ObjectId, OracleId, PlayerId } from "./ids.ts";
import { sameTarget, type Target } from "./objects.ts";

export type ReplacementEffect =
  /**
   * A regeneration shield on `object`: the next time it would be destroyed this turn, it's regenerated instead
   * (CR 701.19a, 614.8). Ends in the cleanup step if unused (CR 514.2).
   */
  | { kind: "regenerationShield"; object: ObjectId }
  /**
   * "Prevent all [combat] damage that would be dealt [to you and creatures you control] this turn" (Fog, Safe Passage;
   * CR 615.1a): checked as each damage event happens, so a creature arriving later is protected too (Safe Passage's
   * ruling). `id` is its own, so a choice can name it (CR 616.1); `sourceOracleId` is the card that made it, which names
   * it to players.
   */
  | {
      kind: "preventAllDamage";
      id: ObjectId;
      sourceOracleId: OracleId;
      controller: PlayerId;
      combatOnly: boolean;
      protects: "everyone" | "controllerAndCreatures";
    }
  /**
   * "The next N damage that [from] would deal to you and/or permanents you control this turn is dealt to [to] instead"
   * (Harm's Way; CR 614.9): `remaining` is how much it still redirects (like a shield; later: CR 615.7); it's used up as damage
   * is redirected, and isn't when none is (CR 609.7b). `from` is the chosen source, followed from the stack onto the
   * battlefield if it's a permanent spell (CR 609.7a).
   */
  | {
      kind: "redirectDamage";
      id: ObjectId;
      sourceOracleId: OracleId;
      controller: PlayerId;
      from: ObjectId;
      remaining: number;
      to: Target;
    };

/**
 * One replacement effect that would apply to an event, named so a player can choose it (CR 616.1) and so it applies
 * once (later: CR 614.5): a card's own replacement by its object and place in `replacementsOf` (stable while a choice waits), an
 * object's regeneration shields (interchangeable, so one reference stands for them all, D-086), or an effect
 * in `GameState.replacements` (made by a resolving spell or ability) by its id.
 */
export type ReplacementRef =
  | { kind: "ownText"; object: ObjectId; index: number }
  | { kind: "regenerationShield"; object: ObjectId }
  | { kind: "resolvedEffect"; id: ObjectId };

/**
 * A choice made while replacing an event: which replacement effect applies first, and what that choice was for, so a
 * choice made for one event or damage entry isn't used for another (CR 616.1); or how a redirection effect with too
 * little left splits it among a source's damage entries (Harm's Way's ruling).
 */
export type ReplacementChoice =
  | { kind: "first"; for: ChoiceFor; ref: ReplacementRef }
  | { kind: "redirectSplit"; effect: ObjectId; shares: RedirectShare[] };

/** How much of one damage entry a redirection effect redirects. */
export type RedirectShare = { entry: DamageEntryKey; amount: number };

/**
 * What a choice between replacement effects is for: the object an event affects, or one entry of a damage event (a
 * source dealing damage to a recipient), by its place in the event as proposed, since one source can deal damage to one
 * recipient twice in an event (Goblin Artillery targeting its own controller). Source and recipient say which damage
 * it is.
 */
export type ChoiceFor = { kind: "object"; object: ObjectId } | DamageEntryKey;

/**
 * One entry of a damage event, by its place in the event as proposed, its source and its recipient, and `hop`: 0 for
 * the entry as proposed, 1 for a part redirected from it, 2 for a part redirected back, and so on, so a part sent away
 * and back to the same recipient isn't the same entry (D-090).
 */
export type DamageEntryKey = { kind: "damage"; index: number; hop: number; source: ObjectId; to: Target };

export function sameChoiceFor(a: ChoiceFor, b: ChoiceFor): boolean {
  switch (a.kind) {
    case "object":
      return b.kind === "object" && a.object === b.object;
    case "damage":
      return (
        b.kind === "damage" && a.index === b.index && a.hop === b.hop && a.source === b.source && sameTarget(a.to, b.to)
      );
  }
}

export function sameReplacement(a: ReplacementRef, b: ReplacementRef): boolean {
  switch (a.kind) {
    case "ownText":
      return b.kind === "ownText" && a.object === b.object && a.index === b.index;
    case "regenerationShield":
      return b.kind === "regenerationShield" && a.object === b.object;
    case "resolvedEffect":
      return b.kind === "resolvedEffect" && a.id === b.id;
  }
}

/** Whether this permanent has a regeneration shield (CR 701.19a). */
export function hasRegenerationShield(state: GameState, object: ObjectId): boolean {
  return state.replacements.some((r) => r.kind === "regenerationShield" && r.object === object);
}

/** The card whose resolution made this effect in `GameState.replacements`, to name it to players, or null if none has the id. */
export function replacementEffectCard(state: GameState, id: ObjectId): OracleId | null {
  for (const effect of state.replacements) {
    switch (effect.kind) {
      case "preventAllDamage":
      case "redirectDamage":
        if (effect.id === id) return effect.sourceOracleId;
        break;
      case "regenerationShield":
        break;
    }
  }
  return null;
}

/** Every replacement effect ends in the cleanup step: all of them last "this turn" so far (CR 514.2). */
export function endReplacementEffects(state: GameState): GameState {
  return state.replacements.length === 0 ? state : { ...state, replacements: [] };
}
