// Continuous effects (CR 611) and what a resolving effect knows about where it came from.
//
// A continuous effect is stored as data: what it changes, which objects, from when (its timestamp), and for how long.
// `characteristics()` applies those that change characteristics in layer order (CR 613); the rules questions read the
// rest ("can't block": `canBlock`). Nothing applies them once and stores the result.

import type { ObjectId, PlayerId } from "./ids.ts";
import type { Share, Target } from "./objects.ts";
import type { TriggerEvent } from "./triggers.ts";

/** How long an effect lasts (CR 611.2a). "Until end of turn" ends in the cleanup step (CR 514.2). */
export type Duration = "endOfTurn";

/** A continuous effect from the resolution of a spell or ability (CR 611.2). */
export type ContinuousEffect = {
  /** The object "this" refers to in the text that created it: the spell, or an ability's source (CR 113.7a). */
  source: ObjectId;
  /** Its controller when the effect was created. */
  controller: PlayerId;
  /** When it was created (CR 613.7b), for applying effects in timestamp order within a layer (CR 613.7). */
  timestamp: number;
  duration: Duration;
  /**
   * The objects it changes, fixed when it begins (CR 611.2c). An object that changes zones is a new object (CR 400.7),
   * so its old id stays here and the effect no longer applies to it.
   */
  affected: ObjectId[];
  change: EffectChange;
};

/** What a continuous effect changes: a characteristic, by layer (CR 613.1), or a rule for the affected objects. */
export type EffectChange =
  /** Layer 7c (CR 613.4c): power and toughness go up or down by these amounts. */
  | { kind: "modifyPT"; power: number; toughness: number }
  /** Not a layer: a rule for the affected creatures, that they can't block (CR 509.1b). */
  | { kind: "cantBlock" }
  /** Not a layer: the affected creatures attack `player` this turn if able (CR 508.1d). */
  | { kind: "mustAttack"; player: PlayerId };

/**
 * What a resolving effect needs to know about the spell or ability it's part of. It's built once, as resolution begins,
 * and travels with the effect's work item.
 */
export type EffectContext = {
  /**
   * The object "this" refers to (`"self"` in a definition): the spell itself, or an ability's source, which may have
   * left its zone (CR 113.7a).
   */
  self: ObjectId;
  /** Who controls the spell or ability: "you" in its text (CR 109.5). */
  controller: PlayerId;
  /**
   * The chosen targets, one group per instance of "target", keeping only those still legal as resolution began
   * (CR 608.2b). Illegal targets aren't affected by the effect.
   */
  targets: Target[][];
  /** The shares of a divided effect whose targets are still legal (CR 601.2d, 608.2b); empty when nothing is divided. */
  division: Share[];
  /** The value announced for X, or null when there is none (CR 107.3a). */
  x: number | null;
  /** For a triggered ability, what it knows of its triggering event ("that player", CR 603.2); otherwise null. */
  trigger: TriggerEvent | null;
};
