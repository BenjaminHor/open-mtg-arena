// Creating continuous effects from resolving spells and abilities (CR 611.2).

import { newTimestamp } from "../game/ids.ts";
import type { Progress } from "../game/progress.ts";
import type { ContinuousEffect } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";

/**
 * A continuous effect begins (CR 611.2a). It gets its timestamp now (CR 613.7b), and the caller has already fixed the
 * objects it affects (CR 611.2c). It changes nothing directly: `characteristics()` applies it (CR 613, M1-11).
 */
export function createContinuousEffect(state: GameState, effect: Omit<ContinuousEffect, "timestamp">): Progress {
  const stamped = newTimestamp(state);
  const created: ContinuousEffect = { ...effect, timestamp: stamped.timestamp };
  return {
    state: { ...stamped.state, effects: [...stamped.state.effects, created] },
    events: [{ type: "EFFECT_CREATED", effect: created }],
  };
}
