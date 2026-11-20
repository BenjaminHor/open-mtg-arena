// Effects as the definition checks read them: an effect nested in another (a condition's effects, a delayed triggered
// ability's) is checked like any other.

import type { Effect } from "@mtg/engine";

/** The effects with those nested in each listed after it, in order, for the checks that read each. */
export function flatEffects(effects: readonly Effect[]): Effect[] {
  return effects.flatMap((e) => [e, ...flatEffects(nestedEffects(e))]);
}

/** The effects written inside this one. */
export function nestedEffects(effect: Effect): readonly Effect[] {
  if (effect.op === "ifNothingSacrificed" || effect.op === "ifActivatedThisTurn") return effect.effects;
  if (effect.op === "createDelayedTrigger") return effect.ability.effects;
  return [];
}
