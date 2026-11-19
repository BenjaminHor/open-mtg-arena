// Playing a land: a special action that doesn't use the stack (CR 116.2a, 305.1).

import type { CardDatabase } from "../cards/types.ts";
import { landPlayProblem } from "../rules/timing.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { moveCard, newCardIdOf } from "../zones/move-card.ts";
import { zoneList } from "../zones/zone-list.ts";
import type { Progress } from "./progress.ts";
import { queueWork } from "./work.ts";

/** Why the player can't play this card as a land now, or null. */
export function playLandProblem(
  state: GameState,
  player: PlayerId,
  card: ObjectId,
  cards: CardDatabase,
): string | null {
  if (!zoneList(state, { zone: "hand", player }).includes(card)) return `${card} isn't in ${player}'s hand`;
  return landPlayProblem(state, player, card, cards);
}

/**
 * The land enters the battlefield under the player's control and counts toward their lands this turn (CR 305.2).
 * Taking an action restarts the passes (CR 117.4), and the player gets priority again (CR 116.3, 117.3c).
 */
export function playLand(state: GameState, player: PlayerId, card: ObjectId): Progress {
  const moved = moveCard(state, card, { zone: "battlefield", controller: player });
  const ps = moved.state.players[player];
  if (ps === undefined) throw new Error(`No player ${player}`);
  const players = { ...moved.state.players, [player]: { ...ps, landsPlayedThisTurn: ps.landsPlayedThisTurn + 1 } };
  const next = queueWork({ ...moved.state, players, passesInSuccession: 0 }, { kind: "givePriority", player });
  return {
    state: next,
    events: [...moved.events, { type: "LAND_PLAYED", player, newId: moved.newId, cardId: newCardIdOf(moved) }],
  };
}
