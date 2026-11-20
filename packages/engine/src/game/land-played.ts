// The part of playing a land that isn't its zone change (CR 305.1): it counts toward the player's land plays this turn
// (CR 305.2).

import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { Progress } from "./progress.ts";

/** Counts the land play and reports it with `LAND_PLAYED`, naming the land as it is now on the battlefield. */
export function countLandPlay(state: GameState, player: PlayerId, land: ObjectId): Progress {
  const ps = state.players[player];
  const obj = state.objects[land];
  if (ps === undefined || obj?.kind !== "card") throw new Error(`Can't count ${player}'s land play`);
  const players = { ...state.players, [player]: { ...ps, landsPlayedThisTurn: ps.landsPlayedThisTurn + 1 } };
  return {
    state: { ...state, players },
    events: [{ type: "LAND_PLAYED", player, newId: land, cardId: obj.cardId }],
  };
}
