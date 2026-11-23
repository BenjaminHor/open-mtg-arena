// Where the stack's labels go (D-174; the owner: a lone object on the stack wasn't "immediately obvious", and Forge's
// stack list "but more polished"): a header over it from one object on, a ring round the top object with a tag under
// it saying whose it is, and a row over each strip under the top naming it in words. The HUD (`hud/StackLabels.tsx`)
// only places them here.

import type { ObjectId } from "@mtg/engine";
import type { BoardCard, Rect } from "./board-model.ts";

export type StackLabels = {
  /** "Stack n": says this is the stack, and lists it all in the zone browser. */
  header: Rect;
  /** Round the top object, waiting to resolve; null while the person chooses for their own spell (the targets' turn). */
  ring: { rect: Rect; radius: number } | null;
  /** Under the ring: whose the top object is, in words. */
  tag: Rect | null;
  /** One per object under the top, over its strip, while the strips are tall enough for a name (the stack large); a
   * small stack's strips show their card frames instead. */
  rows: StackRow[];
  /** Whether the rows say whose each one is: only when both players have objects on it (else the tag says it). */
  rowsSayWhose: boolean;
};

export type StackRow = { id: ObjectId; rect: Rect };

/** Below this a strip is too short for a name in words (`stack.ts` makes them 20 px while large). */
const NAMED_ROW = 18;
/** The ring stands off the card by this, so it's seen round the card's own shadow. */
const RING_GAP = 4;
/** The header: wide enough for "Stack 99" even over a small card, tall enough with its padding for a finger. */
const HEADER = { minWidth: 76, maxWidth: 96, height: 30, gap: 6 };
const TAG_HEIGHT = 14;

/**
 * The labels for the stack as drawn (deepest first), or null when it's empty. Those the open hand would sit on (it
 * can fan across the stack's place) stand down; the header stays, as it's above the hand's reach.
 */
export function stackLabels(
  drawn: readonly BoardCard[],
  openHand: readonly BoardCard[],
  area: Rect,
  choosingOwn: boolean,
): StackLabels | null {
  const deepest = drawn[0];
  const top = drawn.at(-1);
  if (deepest === undefined || top === undefined) return null;
  const width = Math.min(Math.max(top.width, HEADER.minWidth), HEADER.maxWidth);
  // Centred over the card, kept on the screen at the right edge.
  const x = Math.min(top.x + (top.width - width) / 2, area.x + area.width - 4 - width);
  const header = { x, y: deepest.y - HEADER.height - HEADER.gap, width, height: HEADER.height };
  const ringRect = {
    x: top.x - RING_GAP,
    y: top.y - RING_GAP,
    width: top.width + 2 * RING_GAP,
    height: top.height + 2 * RING_GAP,
  };
  const tagRect = { x: ringRect.x, y: ringRect.y + ringRect.height + 3, width: ringRect.width, height: TAG_HEIGHT };
  // A row covers its strip and a pixel either side, so no sliver of the card's frame shows beside it.
  const rows = drawn.flatMap((c) =>
    c.shows === null || c.shows.height < NAMED_ROW
      ? []
      : [{ id: c.id, rect: { x: c.shows.x - 1, y: c.shows.y, width: c.shows.width + 2, height: c.shows.height } }],
  );
  // The fanned hand's cards tilt a little: a margin stands in for their corners' reach.
  const covered = (r: Rect) => openHand.some((h) => overlaps(grow(h, 8), r));
  const coveredAtAll = covered(ringRect) || covered(tagRect) || rows.some((r) => covered(r.rect));
  return {
    header,
    ring:
      choosingOwn || coveredAtAll
        ? null
        : { rect: ringRect, radius: Math.min(top.width, top.height) * 0.07 + RING_GAP },
    tag: choosingOwn || coveredAtAll ? null : tagRect,
    rows: coveredAtAll ? [] : rows,
    rowsSayWhose: new Set(drawn.map((c) => c.mine)).size > 1,
  };
}

function grow(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
