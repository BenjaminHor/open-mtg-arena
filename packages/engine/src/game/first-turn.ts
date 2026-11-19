// The starting player takes the first turn (CR 103.8).

import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";
import { waitFor } from "./decide.ts";
import type { Progress } from "./progress.ts";

/**
 * Begins turn 1 for the starting player. Until M1-06 walks the turn's steps, the untap step is done here (nothing
 * is tapped yet, but the active player's permanents have now been controlled since the turn began, CR 302.6) and the
 * game moves straight to the upkeep, where the active player gets priority (CR 117.3a).
 * The starting player skipping their first draw (CR 103.8a) is part of the draw step, in M1-06.
 */
export function beginFirstTurn(state: GameState): Progress {
  const starting = state.pregame?.startingPlayer;
  if (starting === null || starting === undefined) throw new Error("No starting player");
  const objects = { ...state.objects };
  for (const id of state.zones.battlefield) {
    const obj = objects[id];
    if (obj?.kind === "card" && obj.baseController === starting)
      objects[id] = { ...obj, controlledSinceTurnStart: true };
  }
  const begun: GameState = {
    ...state,
    objects,
    pregame: null,
    turn: { number: 1, activePlayer: starting as PlayerId, step: "upkeep" },
  };
  return {
    state: waitFor(begun, starting, { kind: "priority" }),
    events: [{ type: "TURN_BEGAN", turn: 1, activePlayer: starting }],
  };
}
