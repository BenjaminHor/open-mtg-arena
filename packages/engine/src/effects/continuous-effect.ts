// Creating continuous effects from resolving spells and abilities (CR 611.2).

import { newTimestamp } from "../game/ids.ts";
import type { Progress } from "../game/progress.ts";
import type { ContinuousEffect } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";

/**
 * A continuous effect begins (CR 611.2a). It gets its timestamp now (CR 613.7b), and the caller has already fixed the
 * objects it affects (CR 611.2c). It changes nothing directly: `characteristics()` applies it (CR 613).
 */
export function createContinuousEffect(state: GameState, effect: Omit<ContinuousEffect, "timestamp">): Progress {
  const stamped = newTimestamp(state);
  const created: ContinuousEffect = { ...effect, timestamp: stamped.timestamp };
  return {
    state: { ...stamped.state, effects: [...stamped.state.effects, created] },
    events: [{ type: "EFFECT_CREATED", effect: created }],
  };
}

/**
 * Every "until end of turn" effect ends (CR 514.2, 611.2a). Called by the cleanup step in the same action that removes
 * damage.
 */
export function endUntilEndOfTurnEffects(state: GameState): Progress {
  const ending = state.effects.filter((e) => e.duration === "endOfTurn");
  if (ending.length === 0) return { state, events: [] };
  const ended = { ...state, effects: state.effects.filter((e) => e.duration !== "endOfTurn") };
  // Control going back is a control change too (CR 302.6), which `advance` sees (effects/control-change.ts).
  return {
    state: ended,
    events: ending.map((effect) => ({ type: "EFFECT_ENDED", effect })),
  };
}
