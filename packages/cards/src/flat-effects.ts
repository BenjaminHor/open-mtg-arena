// Effects as the definition checks read them: an effect nested in `ifNothingSacrificed` is checked like any other.

import type { Effect } from "@mtg/engine";

/** The effects with those nested in `ifNothingSacrificed` listed after it, in order, for the checks that read each. */
export function flatEffects(effects: readonly Effect[]): Effect[] {
  return effects.flatMap((e) => (e.op === "ifNothingSacrificed" ? [e, ...flatEffects(e.effects)] : [e]));
}
