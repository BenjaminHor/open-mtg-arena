// Where a tap lands (M3-04b): the regions the HUD lays its buttons over, one per thing a tap can act on. The cards'
// own rectangles overlap (piles, a full row, the fanned hand), so each region is the part of a card that's in sight
// and stands for what's there: a pile for its front card, an open hand card for its visible strip.

import type { BoardCard, BoardModel, Rect } from "./board-model.ts";

export function tapRegions(
  field: readonly BoardCard[],
  hand: readonly BoardCard[],
  handOpen: boolean,
): BoardModel["regions"] {
  // A pile: from its back card's corner to its front card's, under the front card's id.
  const piles = new Map<string, Rect>();
  for (const c of field) {
    const known = piles.get(c.pileOf);
    piles.set(c.pileOf, known === undefined ? rectOf(c) : union(known, rectOf(c)));
  }
  const fieldRegions = [...piles].map(([id, rect]) => ({ id, rect }));
  if (!handOpen) return fieldRegions as BoardModel["regions"];
  // An open hand card's strip: from its left edge to where the next card starts, from its top down. The lifted card
  // (out of the fan, larger) is whole and on top.
  const lifted = hand.filter((c) => c.picked);
  const fan = hand.filter((c) => !c.picked).sort((a, b) => a.x - b.x);
  const strips = fan.map((c, i) => {
    const next = fan[i + 1];
    const right = next === undefined ? c.x + c.width : Math.min(c.x + c.width, next.x);
    return { id: c.id, rect: { x: c.x, y: c.y, width: right - c.x, height: c.height } };
  });
  return [...fieldRegions, ...strips, ...lifted.map((c) => ({ id: c.id, rect: rectOf(c) }))] as BoardModel["regions"];
}

function rectOf(c: BoardCard): Rect {
  return { x: c.x, y: c.y, width: c.width, height: c.height };
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}
