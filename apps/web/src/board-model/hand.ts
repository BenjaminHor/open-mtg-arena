// The person's hand, collapsed [R]: overlapped across the bottom centre in a slight fan, only the top of each card
// showing (its name strip and the top of its art), its mana cost floating above it. The life crest sits over the
// middle of the hand [R], so the hand parts around it rather than hide a card under it. Tapping the hand to fan it
// open is M3-04b.

import type { SeatView } from "@mtg/engine";
import type { BoardLayout } from "../layout/board-layout.ts";
import { boardCard } from "./board-card.ts";
import type { BoardCard, Rect } from "./board-model.ts";
import { cardInfo, manaSymbols } from "./card-info.ts";

export function handCards(shown: SeatView, area: Rect, layout: BoardLayout): BoardCard[] {
  const { hand, ratio } = layout;
  const cards = (shown.view.zones.players[shown.player]?.hand ?? []).flatMap((id) => {
    const seen = shown.seen[id];
    return seen?.kind === "card" ? [seen] : [];
  });
  const n = cards.length;
  if (n === 0) return [];
  const height = hand.h * area.height;
  const width = height * ratio.hand;
  const centre = area.x + area.width / 2;
  const roomLeft = centre - hand.crestGap / 2 - (area.x + hand.left * area.width);
  const roomRight = area.x + hand.right * area.width - (centre + hand.crestGap / 2);
  const { left, step } = bestSplit(n, width, roomLeft, roomRight, hand.mostStep * area.width);
  const xs = cards.map((_, i) =>
    i < left ? centre - hand.crestGap / 2 - (left - i) * step : centre + hand.crestGap / 2 + (i - left) * step,
  );
  const middle = (n - 1) / 2;
  const top = area.y + area.height - hand.shown * height;
  return cards.map((card, i) => {
    const off = i - middle;
    const x = xs[i] ?? 0;
    // A card's own strip runs to where the next card starts; the last card shows its whole width.
    const strip = i < n - 1 ? (xs[i + 1] ?? x) - x - (i === left - 1 ? hand.crestGap : 0) : width;
    const symbols = manaSymbols(card.oracleId === null ? "" : (cardCost(card.oracleId) ?? ""));
    const costRadius = Math.max(hand.minCost, Math.min(hand.cost, strip / (2.05 * Math.max(1, symbols.length))));
    const rect = { x, y: top + off * off * hand.arcDrop * area.height, width, height };
    return boardCard(card, "hand", true, rect, { rotation: off * hand.fan, dim: 0, costRadius });
  });
}

/**
 * How many cards go left of the crest, and the step between cards: the split that gives each card the widest strip.
 * Left of the crest each card's strip is the step; right of it the last card also shows its whole width.
 */
function bestSplit(
  n: number,
  width: number,
  roomLeft: number,
  roomRight: number,
  most: number,
): { left: number; step: number } {
  let best = { left: 0, step: 0 };
  for (let left = 0; left <= n; left++) {
    const rightCount = n - left;
    const fromLeft = left > 0 ? roomLeft / left : Number.POSITIVE_INFINITY;
    // Right of the crest the last card shows whole, so it must fit; nothing right of it limits nothing.
    const fromRight =
      rightCount > 1
        ? (roomRight - width) / (rightCount - 1)
        : rightCount === 1 && roomRight < width
          ? 0
          : Number.POSITIVE_INFINITY;
    const step = Math.min(most, fromLeft, fromRight);
    if (step > best.step) best = { left, step };
  }
  return best;
}

function cardCost(oracleId: string): string | null {
  return cardInfo(oracleId)?.manaCost ?? null;
}
