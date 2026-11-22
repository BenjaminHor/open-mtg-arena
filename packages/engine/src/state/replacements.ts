// Replacement and prevention effects made by resolving spells and abilities (CR 614.1, 615.1), kept until used or
// until they end. A card's own replacements are in its text instead (`CardDef.replacements`).

import type { GameState } from "./game-state.ts";
import type { ObjectId, OracleId, PlayerId } from "./ids.ts";
import type { Target } from "./objects.ts";

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
    };

/**
 * One replacement effect that would apply to an event, named so a player can choose it (CR 616.1) and so it applies
 * once (later: CR 614.5): a card's own replacement by its object and place in `replacementsOf` (stable while a choice waits), an
 * object's regeneration shields (interchangeable, so one reference stands for them all, D-086), or an effect
 * in `GameState.replacements` (made by a resolving spell or ability) by its id.
 */
export type ReplacementRef =
  /**
   * `text`: the copied card's oracle id when the replacement is in the text the object enters as a copy of (CR 614.12),
   * so it isn't taken for the one at the same place in its own text. Left out for its own.
   */
  | { kind: "ownText"; object: ObjectId; index: number; text?: OracleId }
  | { kind: "regenerationShield"; object: ObjectId }
  | { kind: "resolvedEffect"; id: ObjectId }
  /** A permanent's protection, preventing damage from a source with its quality (CR 702.16e). */
  | { kind: "protection"; object: ObjectId };

/**
 * A choice a player made between replacement effects, and what it was for, so a choice made for one event or damage
 * entry isn't used for another (CR 616.1).
 */
export type ReplacementChoice =
  /** Which of several replacement effects applies first (CR 616.1). */
  | { kind: "first"; for: ChoiceFor; ref: ReplacementRef }
  /**
   * What a replacement effect's own choice was as a permanent enters: a card name or a basic land type, "as this
   * enters, choose a card name" (CR 614.12a, 201.4), or the permanent it enters as a copy of (CR 707.5), null for none. Made before it enters, and kept so replacing the event again doesn't ask again.
   */
  | { kind: "asEnters"; for: ChoiceFor; ref: ReplacementRef; chosen: string | null };

/**
 * What a choice between replacement effects is for: the object an event affects, or one entry of a damage event (a
 * source dealing damage to a recipient), by its place in the event as proposed, since one source can deal damage to one
 * recipient twice in an event (Goblin Artillery targeting its own controller). Source and recipient say which damage
 * it is.
 */
export type ChoiceFor =
  | { kind: "object"; object: ObjectId }
  | { kind: "damage"; index: number; source: ObjectId; to: Target };

export function sameChoiceFor(a: ChoiceFor, b: ChoiceFor): boolean {
  switch (a.kind) {
    case "object":
      return b.kind === "object" && a.object === b.object;
    case "damage":
      return b.kind === "damage" && a.index === b.index && a.source === b.source && sameTarget(a.to, b.to);
  }
}

function sameTarget(a: Target, b: Target): boolean {
  return a.kind === "player"
    ? b.kind === "player" && a.player === b.player
    : b.kind === "object" && a.object === b.object;
}

export function sameReplacement(a: ReplacementRef, b: ReplacementRef): boolean {
  switch (a.kind) {
    case "ownText":
      return b.kind === "ownText" && a.object === b.object && a.index === b.index && a.text === b.text;
    case "regenerationShield":
      return b.kind === "regenerationShield" && a.object === b.object;
    case "resolvedEffect":
      return b.kind === "resolvedEffect" && a.id === b.id;
    case "protection":
      return b.kind === "protection" && a.object === b.object;
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
