// What the person sees of hidden zones: the opponent's hand as card backs along the top edge, left of centre, mostly off
// screen (CR 402.3: its size is public, its cards aren't), and each library as a face-down pile with its count
// (CR 401.3) [R].

import type { PlayerId, SeatView } from "@mtg/engine";
import { COMPACT } from "../layout/compact.ts";
import type { CardBack, LibraryPile, PlayArea } from "./board-model.ts";

export function cardBacks(count: number, area: PlayArea): CardBack[] {
  const { opponentHand, ratio } = COMPACT;
  const height = opponentHand.h * area.h;
  const width = height * ratio.hand;
  const step = opponentHand.step * area.w;
  const middle = (count - 1) / 2;
  const centre = area.x + opponentHand.centre * area.w;
  return Array.from({ length: count }, (_, i) => ({
    key: `back-${i}`,
    x: centre - width / 2 + (i - middle) * step,
    y: area.y + opponentHand.shown * height - height,
    width,
    height,
    // Held facing the person, so the fan opens downward.
    rotation: -(i - middle) * COMPACT.hand.fan,
  }));
}

export function libraryPiles(shown: SeatView, area: PlayArea, opponent: PlayerId): LibraryPile[] {
  const { library, ratio } = COMPACT;
  const height = library.h * area.h;
  const width = height * ratio.hand;
  const pile = (player: PlayerId, mine: boolean): LibraryPile => {
    const place = mine ? library.mine : library.opponent;
    return {
      player,
      mine,
      x: area.x + place.x * area.w - width / 2,
      y: mine ? area.y + area.h - place.shown * height : area.y + place.shown * height - height,
      width,
      height,
      count: shown.view.zones.players[player]?.librarySize ?? 0,
    };
  };
  return [pile(opponent, false), pile(shown.player, true)];
}
