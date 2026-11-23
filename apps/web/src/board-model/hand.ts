// The person's hand, collapsed [R]: overlapped across the bottom centre in a slight fan, only the top of each card
// showing (its name strip and the top of its art), its mana cost floating above it. Tapping it to fan it open is M3-04b.

import type { SeatView } from "@mtg/engine";
import { COMPACT } from "../layout/compact.ts";
import { boardCard } from "./board-card.ts";
import type { BoardCard, PlayArea } from "./board-model.ts";

export function handCards(shown: SeatView, area: PlayArea): BoardCard[] {
  const { hand, ratio } = COMPACT;
  const cards = (shown.view.zones.players[shown.player]?.hand ?? []).flatMap((id) => {
    const seen = shown.seen[id];
    return seen?.kind === "card" ? [seen] : [];
  });
  const height = hand.h * area.h;
  const width = height * ratio.hand;
  const left = area.x + hand.left * area.w;
  const room = hand.right * area.w - hand.left * area.w;
  const step = cards.length > 1 ? Math.min(hand.mostStep * area.w, (room - width) / (cards.length - 1)) : 0;
  const span = width + step * Math.max(0, cards.length - 1);
  const start = left + (room - span) / 2;
  const middle = (cards.length - 1) / 2;
  const top = area.y + area.h - hand.shown * height;
  return cards.map((card, i) => {
    const off = i - middle;
    const rect = { x: start + i * step, y: top + off * off * hand.arcDrop * area.h, width, height };
    return boardCard(card, "hand", true, rect, { rotation: off * hand.fan, alpha: 1 });
  });
}
