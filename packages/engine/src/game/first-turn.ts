// The starting player takes the first turn (CR 103.8).

import { controllerOf } from "../rules/controller.ts";
import type { GameState } from "../state/game-state.ts";
import { givePriority } from "./priority.ts";
import type { Progress } from "./progress.ts";

/**
 * Begins turn 1 for the starting player. Until M1-06 walks the turn's steps, the untap step is done here: the active
 * player's permanents untap (CR 502.3) and have now been under their control since the turn began (CR 302.6). Then the
 * game moves straight to the upkeep, where the active player gets priority (CR 117.3a).
 * The starting player skipping their first draw (CR 103.8a) is part of the draw step, in M1-06.
 */
export function beginFirstTurn(state: GameState): Progress {
  const starting = state.pregame?.startingPlayer;
  if (starting === null || starting === undefined) throw new Error("No starting player");
  // Status bookkeeping, not a game event: no ZONE_CHANGED or tap event is needed for these flags.
  const objects = { ...state.objects };
  for (const id of state.zones.battlefield) {
    const obj = objects[id];
    if (obj?.kind === "card" && controllerOf(state, id) === starting) {
      objects[id] = { ...obj, tapped: false, controlledSinceTurnStart: true };
    }
  }
  const begun: GameState = {
    ...state,
    objects,
    pregame: null,
    turn: { number: 1, activePlayer: starting, step: "upkeep" },
  };
  return {
    state: givePriority(begun, starting),
    events: [{ type: "TURN_BEGAN", turn: 1, activePlayer: starting }],
  };
}
