// Cards that rules make public while they stay in a hidden zone (CR 400.2: a hand or library is still a hidden zone
// "even if all the cards in one such zone happen to be revealed"): hands "played revealed" (Telepathy) and a library's
// top card (Vampire Nocturnus), each "play with ..." effect lasting as long as the game is played (CR 701.18c). Read from
// the permanents' abilities as they are now (CR 613), so a stolen Nocturnus reveals its new controller's library and
// one that lost its abilities reveals nothing. A revealed card is shown to every player (CR 701.20a).

import type { CardDatabase } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";
import { layered } from "./layers.ts";

/** Whose hands and whose library tops are revealed now. */
export type Revealed = { hands: PlayerId[]; tops: PlayerId[] };

/**
 * One walk of the battlefield, reading each permanent's abilities and controller from the layer pass (`controllerOf`
 * agrees with it, D-104): a `playWithRevealed` reveals the hands or library tops (CR 401.5) of its controller ("you") or of its
 * controller's opponents (CR 102.2, any other player, two players only so far). The view shows a top by identity, so it
 * needn't become a new object when it stops being revealed (later: CR 401.6).
 */
export function revealedBy(state: GameState, cards: CardDatabase): Revealed {
  const board = layered(state, cards);
  const hands: PlayerId[] = [];
  const tops: PlayerId[] = [];
  for (const id of state.zones.battlefield) {
    const card = board[id];
    if (card === undefined) continue;
    for (const a of card.statics) {
      if (a.kind !== "playWithRevealed") continue;
      const whose = a.whose === "you" ? [card.controller] : state.turnOrder.filter((p) => p !== card.controller);
      (a.what === "hand" ? hands : tops).push(...whose);
    }
  }
  return {
    hands: state.turnOrder.filter((p) => hands.includes(p)),
    tops: state.turnOrder.filter((p) => tops.includes(p)),
  };
}

/** The players whose hands are revealed (Telepathy). */
export function handsRevealed(state: GameState, cards: CardDatabase): PlayerId[] {
  return revealedBy(state, cards).hands;
}

/** The players whose library's top card is revealed (Vampire Nocturnus). */
export function libraryTopsRevealed(state: GameState, cards: CardDatabase): PlayerId[] {
  return revealedBy(state, cards).tops;
}
