// What the person sees of hidden zones: the opponent's hand as card backs along the top edge, mostly off screen
// (CR 402.3: its size is public, its cards aren't). Each library is a count in its player's info block (CR 401.3),
// not a pile (the owner, ui.md "Player info in the left corners").

import type { BoardLayout } from "../layout/board-layout.ts";
import type { CardBack, Rect } from "./board-model.ts";

export function cardBacks(count: number, area: Rect, layout: BoardLayout): CardBack[] {
  const { opponentHand, ratio } = layout;
  const height = opponentHand.h * area.height;
  const width = height * ratio.hand;
  const step = opponentHand.step * area.width;
  const middle = (count - 1) / 2;
  const centre = area.x + opponentHand.centre * area.width;
  return Array.from({ length: count }, (_, i) => ({
    key: `back-${i}`,
    x: centre - width / 2 + (i - middle) * step,
    y: area.y + opponentHand.shown * height - height,
    width,
    height,
    // Held facing the person, so the fan opens downward.
    rotation: -(i - middle) * layout.hand.fan,
  }));
}
