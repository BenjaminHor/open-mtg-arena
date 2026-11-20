// Playing a land: a special action that doesn't use the stack (CR 116.2a, 305.1).

import type { CardDatabase } from "../cards/types.ts";
import { happen } from "../pipeline/happen.ts";
import { landPlayProblem } from "../rules/timing.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
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
 * The land is played (the `playLand` event: it enters the battlefield, CR 305.1, and counts, CR 305.2). Taking an
 * action restarts the passes (CR 117.4), and the player gets priority again (CR 116.3, 117.3c).
 */
export function playLand(state: GameState, player: PlayerId, card: ObjectId, cards: CardDatabase): Progress {
  const played = happen(state, { kind: "playLand", player, object: card }, cards);
  const next = queueWork({ ...played.state, passesInSuccession: 0 }, { kind: "givePriority", player });
  return { state: next, events: played.events };
}
