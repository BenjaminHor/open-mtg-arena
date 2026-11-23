// The person's hand, collapsed [R]: overlapped across the bottom centre in a slight fan, only the top of each card
// showing (its name strip and the top of its art), its mana cost floating above it. Opened (a tap on it), the hand
// fans up across most of the width [R].

import type { ObjectId, SeatView } from "@mtg/engine";
import type { BoardLayout } from "../layout/board-layout.ts";
import { boardCard } from "./board-card.ts";
import type { BoardCard, Rect } from "./board-model.ts";
import { cardBasis } from "./card-basis.ts";
import { cardInfo, manaSymbols } from "./card-info.ts";

export function handCards(
  shown: SeatView,
  area: Rect,
  layout: BoardLayout,
  open: boolean,
  lifted: ObjectId | null,
): BoardCard[] {
  const hand = open ? layout.handOpen : layout.hand;
  const { ratio } = layout;
  const cards = (shown.view.zones.players[shown.player]?.hand ?? []).flatMap((id) => {
    const seen = shown.seen[id];
    return seen?.kind === "card" ? [seen] : [];
  });
  const n = cards.length;
  if (n === 0) return [];
  const height = hand.h * cardBasis(area, layout);
  const width = height * ratio.hand;
  // Centred, each card a step after the last, at most `mostStep`, the last one shown whole.
  const room = (hand.right - hand.left) * area.width;
  const step = n > 1 ? Math.min(hand.mostStep * area.width, (room - width) / (n - 1)) : 0;
  const start = area.x + area.width / 2 - (width + step * (n - 1)) / 2;
  const middle = (n - 1) / 2;
  const top = area.y + area.height - hand.shown * height;
  const placed = cards.map((card, i) => {
    const off = i - middle;
    const x = start + i * step;
    // A card's own strip runs to where the next card starts; the last card shows its whole width.
    const strip = i === n - 1 ? width : step;
    const symbols = manaSymbols(card.oracleId === null ? "" : (cardCost(card.oracleId) ?? ""));
    const costRadius = Math.max(hand.minCost, Math.min(hand.cost, strip / (2.05 * Math.max(1, symbols.length))));
    const rect = { x, y: top + off * off * hand.arcDrop * area.height, width, height };
    return boardCard(card, "hand", true, rect, { rotation: off * hand.fan, dim: 0, row: "hand", costRadius });
  });
  // The lifted card leaves the fan and rises large at the centre [R], drawn over everything else in the hand.
  const liftedCard = placed.find((c) => c.id === lifted);
  if (liftedCard === undefined) return placed;
  const h = layout.lifted.h * cardBasis(area, layout);
  const w = h * ratio.hand;
  const big = {
    ...liftedCard,
    x: area.x + area.width / 2 - w / 2,
    y: area.y + layout.lifted.top * area.height,
    width: w,
    height: h,
  };
  return [...placed.filter((c) => c.id !== lifted), { ...big, rotation: 0, costRadius: hand.cost * 1.4 }];
}

function cardCost(oracleId: string): string | null {
  return cardInfo(oracleId)?.manaCost ?? null;
}
