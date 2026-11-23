// The stack, at its simplest for now (M3-04b): the object on top, shown large right of centre while it waits [R]
// (arena-research.md, "The opponent's spell ... shown as a large card at the right of centre"), so the person sees the
// spell they're choosing targets for, or the one the opponent cast. A spell is its card; an ability shows the card it
// came from. How many more wait under it is a count. The whole stack, with targets and order, is M3-04c.

import type { SeatView } from "@mtg/engine";
import type { BoardLayout } from "../layout/board-layout.ts";
import { boardCard } from "./board-card.ts";
import type { BoardCard, Rect } from "./board-model.ts";

export function stackTop(shown: SeatView, area: Rect, layout: BoardLayout): BoardCard[] {
  const stack = shown.view.zones.stack;
  const topId = stack[stack.length - 1];
  const top = topId === undefined ? undefined : shown.seen[topId];
  if (top === undefined) return [];
  const card = top.kind === "card" ? top : shown.seen[top.source];
  if (card?.kind !== "card") return [];
  // While the person chooses for it (targets, X, paying), it's small at the right edge, never over a target [R].
  const choosing = shown.view.casting !== null && shown.view.casting.player === shown.player;
  const height = (choosing ? layout.stack.smallH : layout.stack.h) * area.height;
  const width = height * layout.ratio.hand;
  const right = area.x + area.width - 8;
  const x = choosing ? right - width : Math.min(area.x + layout.stack.x * area.width, right - width);
  const y = area.y + (choosing ? layout.stack.smallY : layout.stack.y) * area.height;
  const rect = { x, y, width, height };
  const shownCard = boardCard(card, "stack", card.characteristics.controller === shown.player, rect, {
    rotation: 0,
    dim: 0,
    row: "stack",
    pileCount: stack.length > 1 ? stack.length : null,
  });
  // An ability is drawn as its source card: its id is the ability's, so the card on the battlefield keeps its own.
  return [
    {
      ...shownCard,
      id: top.id,
      name: top.kind === "ability" ? `${card.characteristics.name} ability` : shownCard.name,
    },
  ];
}
