// Continuous effects (CR 611) and what a resolving effect knows about where it came from.
//
// A continuous effect is stored as data: what it changes, which objects, from when (its timestamp), and for how long.
// `characteristics()` applies them in layer order (CR 613, M1-11); nothing applies them once and stores the result.

import type { ObjectId, PlayerId } from "./ids.ts";
import type { Target } from "./objects.ts";

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

/** What a continuous effect changes, by layer (CR 613.1). Later layers add kinds. */
export type EffectChange =
  /** Layer 7c (CR 613.4c): power and toughness go up or down by these amounts. */
  { kind: "modifyPT"; power: number; toughness: number };

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
};
