// The stack's targets marked on the board (M3-04c slice 6b; arena-research.md: "a targeting arc is drawn as a glowing
// curve from the stack item to its target" [R]): an arrow from the top object to each target the board shows, a card
// where it's drawn (a pile's front for a card behind it) or a player's info block. A target the board doesn't show (a
// card in a graveyard, one gone) has no arrow: the card view names it (`stack-details.ts`). The objects under the top
// show theirs in their card views, as Arena shows them on hover [R].

import type { SeatView, Target } from "@mtg/engine";
import type { BoardCard, OverlayAnchors, Point, Rect } from "./board-model.ts";

export type TargetArrow = { from: Point; to: Point };

export function targetArrows(
  shown: SeatView,
  cards: readonly BoardCard[],
  overlay: OverlayAnchors,
  handOpen: boolean,
): TargetArrow[] {
  // While a spell or ability is being put on the stack, its targets are still being chosen: the dashed outlines show
  // what can be, and nothing is chosen yet to point at. With the hand open, it covers the board and an arrow would end
  // on a hand card; the hand closes on the next action.
  if (shown.view.casting !== null || handOpen) return [];
  const stack = cards.filter((c) => c.zone === "stack");
  const top = stack.at(-1);
  if (top === undefined) return [];
  const object = shown.seen[top.id];
  // The same object chosen for two "target" words (CR 115.3) is one arrow.
  const targets = [...new Map((object?.choices?.targets.flat() ?? []).map((t) => [JSON.stringify(t), t])).values()];
  const from = { x: top.x, y: top.y + top.height / 2 };
  return targets.flatMap((target) => {
    const to = targetPoint(shown, target, cards, overlay);
    return to === null ? [] : [{ from, to }];
  });
}

function targetPoint(
  shown: SeatView,
  target: Target,
  cards: readonly BoardCard[],
  overlay: OverlayAnchors,
): Point | null {
  if (target.kind === "player") {
    // The edge of their info block facing the board, so the life total isn't under the arrowhead. Two players for now:
    // later, with more (CR 800), the block found by player id.
    const block = target.player === shown.player ? overlay.player.mine : overlay.player.opponent;
    return { x: block.x + block.width, y: block.y + block.height / 2 };
  }
  const card = cards.find((c) => c.id === target.object);
  if (card === undefined) return null;
  // An object under the stack's top shows only its name strip: the arrow ends at the strip's left edge, so it runs up
  // beside the stack rather than across the face of what's on top.
  if (card.zone === "stack") return card.shows === null ? null : { x: card.x, y: card.shows.y + card.shows.height / 2 };
  // A card behind a pile's front is drawn under it: the arrow goes to the front, where it's seen. An Aura beside its
  // host shows its left edge only: the arrow goes there, not onto the host.
  const shownAt = card.behind ? (cards.find((c) => c.id === card.pileOf) ?? card) : card;
  return centre(shownAt.shows ?? shownAt);
}

function centre(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}
