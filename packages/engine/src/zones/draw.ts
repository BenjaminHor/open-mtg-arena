// Drawing a card (CR 121): the top card of the library goes to its owner's hand.

import type { Progress } from "../game/progress.ts";
import { zoneChangeOf } from "../pipeline/moved.ts";
import type { CarryOut } from "../pipeline/proposed.ts";
import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";
import { zoneList } from "./zone-list.ts";

function playerState(state: GameState, player: PlayerId) {
  const p = state.players[player];
  if (p === undefined) throw new Error(`No player ${player}`);
  return p;
}

/**
 * The player puts the top card of their library into their hand (CR 121.1), a zone change proposed through `next`.
 * Emits `CARD_DRAWN` as well, so "whenever you draw" triggers and the UI can tell a draw from other ways a card
 * reaches the hand.
 */
export function drawCard(state: GameState, player: PlayerId, next: CarryOut): Progress {
  const top = zoneList(state, { zone: "library", player })[0];
  if (top === undefined) {
    // Nothing is drawn, and the player will lose when state-based actions are next checked (CR 121.4, 704.5b).
    const players = {
      ...state.players,
      [player]: { ...playerState(state, player), attemptedDrawFromEmptyLibrary: true },
    };
    return { state: { ...state, players }, events: [] };
  }
  const card = state.objects[top];
  if (card?.kind !== "card") throw new Error(`${top} in a library isn't a card`);
  const moved = next(state, { kind: "moveCard", object: top, to: { zone: "hand" } });
  const change = zoneChangeOf(moved.events, top);
  if (change === null) throw new Error(`${top} wasn't drawn`);
  const drawn = { type: "CARD_DRAWN", player, newId: change.newId, cardId: change.newCardId } as const;
  return { state: moved.state, events: [...moved.events, drawn] };
}
