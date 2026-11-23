// The stack's targets marked on the board (M3-04c slice 6b; arena-research.md: "a targeting arc is drawn as a glowing
// curve from the stack item to its target" [R]): an arrow from the top object to each target the board shows, a card
// where it's drawn (a pile's front for a card behind it) or a player's info block. A target the board doesn't show (a
// card in a graveyard, one gone) has no arrow: the card view names it (`stack-details.ts`). The objects under the top
// show theirs in their card views, as Arena shows them on hover [R].

import type { SeatView, Target } from "@mtg/engine";
import type { BoardCard, OverlayAnchors, Point, Rect } from "./board-model.ts";

export type TargetArrow = { from: Point; to: Point };

export function targetArrows(shown: SeatView, cards: readonly BoardCard[], overlay: OverlayAnchors): TargetArrow[] {
  // While a spell or ability is being put on the stack, its targets are still being chosen: the dashed outlines show
  // what can be, and nothing is chosen yet to point at.
  if (shown.view.casting !== null) return [];
  const stack = cards.filter((c) => c.zone === "stack");
  const top = stack.at(-1);
  if (top === undefined) return [];
  const object = shown.seen[top.id];
  const targets = object?.choices?.targets.flat() ?? [];
  const from = { x: top.x, y: top.y + top.height / 2 };
  return targets.flatMap((target) => {
    const to = targetPoint(shown, target, cards, stack, overlay);
    return to === null ? [] : [{ from, to }];
  });
}

function targetPoint(
  shown: SeatView,
  target: Target,
  cards: readonly BoardCard[],
  stack: readonly BoardCard[],
  overlay: OverlayAnchors,
): Point | null {
  if (target.kind === "player") {
    return centre(target.player === shown.player ? overlay.player.mine : overlay.player.opponent);
  }
  const card = cards.find((c) => c.id === target.object);
  if (card === undefined) return null;
  if (card.zone === "stack") {
    // An object under the top shows only its strip, up to the next one's edge.
    const above = stack[stack.indexOf(card) + 1];
    if (above === undefined) return null;
    return { x: card.x + card.width / 2, y: card.y + (above.y - card.y) / 2 };
  }
  // A card behind a pile's front is drawn under it: the arrow goes to the front, where it's seen.
  const shownAt = card.behind ? (cards.find((c) => c.id === card.pileOf) ?? card) : card;
  return centre(shownAt);
}

function centre(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}
