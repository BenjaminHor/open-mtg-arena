// Mana going into and out of a player's mana pool (CR 106.4).

import type { Progress } from "../game/progress.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { ManaType } from "../state/mana.ts";

/** An effect adds mana to a player's mana pool (CR 106.4). `source` is the object whose ability made it. */
export function addMana(
  state: GameState,
  player: PlayerId,
  mana: ManaType,
  amount: number,
  source: ObjectId,
): Progress {
  const ps = state.players[player];
  if (ps === undefined) throw new Error(`No player ${player}`);
  const manaPool = { ...ps.manaPool, [mana]: ps.manaPool[mana] + amount };
  return {
    state: { ...state, players: { ...state.players, [player]: { ...ps, manaPool } } },
    events: [{ type: "MANA_ADDED", player, mana, amount, source }],
  };
}
