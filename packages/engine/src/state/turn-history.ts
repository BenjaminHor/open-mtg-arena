// Facts about the current turn that later rules ask about ("if this ability has been activated four or more times this
// turn"), all emptied as each turn begins (docs/architecture.md, "GameState").

import type { ObjectId } from "./ids.ts";

export type TurnHistory = {
  /** Activated abilities' activations this turn (D-078). */
  activations: ActivationCount[];
};

/**
 * How many times this turn an object's printed activated ability has become activated (D-078: counted as it's
 * activated, whether or not it resolves), for "if this ability has been activated four or more times this turn".
 */
export type ActivationCount = { object: ObjectId; index: number; count: number };

/** A turn's history as it begins. */
export const newTurnHistory = (): TurnHistory => ({ activations: [] });
