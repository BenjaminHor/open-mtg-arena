// Piles of interchangeable permanents [R]: lands of one name in the owner's screenshots, identical tokens in Arena's
// (ui.md, "The cards"). A pile shows its front card whole, the cards behind it peeking out at its left and below, and
// its size on a badge. Each card keeps its own rectangle, so a later touch can pick one.

import type { SeenCard } from "@mtg/engine";
import type { BoardLayout } from "../layout/board-layout.ts";
import { boardCard } from "./board-card.ts";
import type { BoardCard, Rect } from "./board-model.ts";

/** At most this many cards of a pile show behind its front card; the rest sit exactly behind the last of them. */
export const PILE_DEPTH = 3;

/**
 * Two permanents look the same, so they can share a pile: the same name, power/toughness, colours, types,
 * keywords and protections as they are now, both tapped or both not, no counters, damage or regeneration shields, the same choice
 * made as they entered, both tokens or both cards, nothing attached either way, not in combat, not picked. Null for a
 * permanent that stands alone (`apart` holds those something is attached to, and the picked ones).
 */
export function pileKey(card: SeenCard, apart: ReadonlySet<string>): string | null {
  const plain =
    Object.keys(card.counters).length === 0 &&
    card.damage === 0 &&
    card.regenerationShields === 0 &&
    card.attachedTo === null &&
    !apart.has(card.id) &&
    card.attacking === null &&
    card.blocking.length === 0;
  if (!plain) return null;
  const c = card.characteristics;
  return JSON.stringify([
    c.name,
    c.power,
    c.toughness,
    c.colors,
    c.types,
    c.subtypes,
    c.keywords,
    c.protections,
    card.chosen,
    card.tapped,
    card.summoningSick,
    card.token,
  ]);
}

/** Groups cards into piles by `pileKey`, each pile in the order its first card came; a card with no key is alone. */
export function pilesOf(cards: readonly SeenCard[], apart: ReadonlySet<string>): SeenCard[][] {
  const piles = new Map<string, SeenCard[]>();
  for (const card of cards) {
    const key = pileKey(card, apart) ?? card.id;
    piles.set(key, [...(piles.get(key) ?? []), card]);
  }
  return [...piles.values()];
}

/** How far the cards behind a pile's front peek out, in px. */
export function pileOffsets(area: Rect, layout: BoardLayout): { step: number; lift: number } {
  return { step: layout.lands.pileStep * area.width, lift: layout.lands.pileLift * area.height };
}

/** The width a pile of `count` cards takes. */
export function pileWidth(count: number, cardWidth: number, step: number): number {
  return cardWidth + step * Math.min(count - 1, PILE_DEPTH);
}

/** The cards of one pile, back to front, its front card at the pile's right and carrying the count. */
export function placePile(
  pile: readonly SeenCard[],
  at: Rect,
  offsets: { step: number; lift: number },
  mine: boolean,
  row: "creatures" | "lands",
  look: (card: SeenCard) => { rotation: number; dim: number },
): BoardCard[] {
  const depth = Math.min(pile.length - 1, PILE_DEPTH);
  const frontId = pile[pile.length - 1]?.id;
  return pile.map((card, j) => {
    const behind = Math.min(pile.length - 1 - j, PILE_DEPTH);
    const front = j === pile.length - 1;
    const rect = {
      x: at.x + (depth - behind) * offsets.step,
      y: at.y + behind * offsets.lift,
      width: at.width,
      height: at.height,
    };
    return boardCard(card, "battlefield", mine, rect, {
      ...look(card),
      row,
      ...(frontId === undefined ? {} : { pileOf: frontId }),
      pileCount: front && pile.length > 1 ? pile.length : null,
      behind: !front,
    });
  });
}
