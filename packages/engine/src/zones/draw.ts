// Drawing a card (CR 121): the top card of the library goes to its owner's hand.

import { andThen, type Progress } from "../game/progress.ts";
import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";
import { moveCard, newCardIdOf } from "./move-card.ts";
import { zoneList } from "./zone-list.ts";

function playerState(state: GameState, player: PlayerId) {
  const p = state.players[player];
  if (p === undefined) throw new Error(`No player ${player}`);
  return p;
}

/**
 * Emits `CARD_DRAWN` as well as the zone change, so "whenever you draw" triggers and the UI can tell a draw from
 * other ways a card reaches the hand.
 */
export function drawCard(state: GameState, player: PlayerId): Progress {
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
  const moved = moveCard(state, top, { zone: "hand" });
  const drawn = { type: "CARD_DRAWN", player, newId: moved.newId, cardId: newCardIdOf(moved) } as const;
  return { state: moved.state, events: [...moved.events, drawn] };
}

export function drawCards(state: GameState, player: PlayerId, count: number): Progress {
  let progress: Progress = { state, events: [] };
  for (let i = 0; i < count; i++) progress = andThen(progress, (s) => drawCard(s, player));
  return progress;
}
