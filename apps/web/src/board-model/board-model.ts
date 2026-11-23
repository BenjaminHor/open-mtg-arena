// The board model (ui.md, "Board structure"): what the person's seat is shown (`SeatView`) plus the screen size, turned
// into plain data, every visible card with its place and state. The renderer draws it and does no layout of its own,
// so the layout is tested here without drawing anything. This first version lays out three rows: the opponent's
// permanents, the person's permanents, the person's hand. M3-04 replaces it with Arena's layout (arena-research.md).

import type { ObjectId, PlayerId, SeatView, SeenCard } from "@mtg/engine";

export type BoardCard = {
  id: ObjectId;
  name: string;
  zone: "battlefield" | "hand";
  /** Controlled by the person whose board this is. */
  mine: boolean;
  /** The card's rectangle, in CSS pixels from the board's top left, before turning it for `tapped`. */
  x: number;
  y: number;
  width: number;
  height: number;
  tapped: boolean;
  power: number | null;
  toughness: number | null;
};

export type BoardModel = {
  width: number;
  height: number;
  cards: BoardCard[];
  /** The opponent's hand is hidden (CR 402.3): only how many cards it holds. */
  opponentHandSize: number;
};

export type BoardSize = { width: number; height: number };

/** Cards are shaped like a Magic card: 63 by 88 mm. */
const CARD_RATIO = 63 / 88;
const GAP = 8;

export function boardModel(shown: SeatView, size: BoardSize): BoardModel {
  const me = shown.player;
  const opponent = shown.view.turnOrder.find((p) => p !== me) ?? me;
  const cardHeight = Math.min(size.height * 0.24, 160);
  const cardWidth = cardHeight * CARD_RATIO;
  const permanents = shown.view.zones.battlefield.flatMap((id) => seenCard(shown, id));
  const hand = (shown.view.zones.players[me]?.hand ?? []).flatMap((id) => seenCard(shown, id));
  const rows: { cards: SeenCard[]; zone: BoardCard["zone"]; y: number }[] = [
    { cards: permanents.filter((c) => controller(c) === opponent), zone: "battlefield", y: size.height * 0.04 },
    { cards: permanents.filter((c) => controller(c) === me), zone: "battlefield", y: size.height * 0.36 },
    { cards: hand, zone: "hand", y: size.height - cardHeight - size.height * 0.04 },
  ];
  const cards = rows.flatMap((row) => placeRow(row.cards, row.zone, row.y, me, size.width, cardWidth, cardHeight));
  return { width: size.width, height: size.height, cards, opponentHandSize: handSize(shown, opponent) };
}

/**
 * One row of cards, centred. A tapped card is turned sideways (CR 701.26a), so it takes its height in width. A row
 * wider than the board overlaps its cards evenly from edge to edge instead.
 */
function placeRow(
  row: readonly SeenCard[],
  zone: BoardCard["zone"],
  y: number,
  me: PlayerId,
  width: number,
  cardWidth: number,
  cardHeight: number,
): BoardCard[] {
  const footprint = (card: SeenCard) => (card.tapped ? cardHeight : cardWidth);
  const natural = row.reduce((sum, card) => sum + footprint(card), 0) + GAP * Math.max(0, row.length - 1);
  const fits = natural <= width - 2 * GAP;
  const overlapStep = row.length > 1 ? (width - 2 * GAP - cardHeight) / (row.length - 1) : 0;
  let left = (width - natural) / 2;
  return row.map((card, i) => {
    // The card's own rectangle is centred in its slot; the renderer turns it about that centre.
    const slotLeft = fits ? left : GAP + i * overlapStep;
    const slot = fits ? footprint(card) : cardHeight;
    left += footprint(card) + GAP;
    return {
      id: card.id,
      name: card.characteristics.name,
      zone,
      mine: controller(card) === me,
      x: slotLeft + slot / 2 - cardWidth / 2,
      y,
      width: cardWidth,
      height: cardHeight,
      tapped: card.tapped,
      power: card.characteristics.power,
      toughness: card.characteristics.toughness,
    };
  });
}

function seenCard(shown: SeatView, id: ObjectId): SeenCard[] {
  const seen = shown.seen[id];
  return seen?.kind === "card" ? [seen] : [];
}

function controller(card: SeenCard): PlayerId {
  return card.characteristics.controller;
}

function handSize(shown: SeatView, player: PlayerId): number {
  return shown.view.zones.players[player]?.handSize ?? 0;
}
