// "Regenerate [it]": a regeneration shield (CR 701.19a, 614.8), a replacement effect kept in `GameState.replacements`
// until used, or until the cleanup step ends it (CR 514.2). Made outside the event pipeline, like a continuous effect:
// making one isn't regenerating (CR 701.19c). Using one is the pipeline's (`pipeline/replacements.ts`).

import type { Progress } from "../game/progress.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";

/** A shield for each of these permanents; ones no longer on the battlefield get none (there's nothing to protect). */
export function addRegenerationShields(state: GameState, permanents: readonly ObjectId[]): Progress {
  const shields = permanents.map((object) => ({ kind: "regenerationShield", object }) as const);
  return { state: { ...state, replacements: [...state.replacements, ...shields] }, events: [] };
}

/** Every replacement effect ends in the cleanup step: all of them last "this turn" (CR 514.2). */
export function endReplacementEffects(state: GameState): GameState {
  return state.replacements.length === 0 ? state : { ...state, replacements: [] };
}
