// What a permanent wears on its tile besides its name and power/toughness (M3-04c; arena-research.md, "How permanents
// are drawn"): its keyword icons [R], its counters [R], a planeswalker's loyalty [R], and summoning sickness's mark [R].
// Decided here, pure and tested; the renderer only draws it (battlefield-tile.ts). The card view lists everything in
// words, so a badge can stay small.

import type { Keyword, PlayerId, SeenCard } from "@mtg/engine";

/** A keyword with an icon of its own, or protection (CR 702.16), which is an ability with a quality. */
export type BadgeIcon = Exclude<Keyword, "flash"> | "protection";

export type Badges = {
  /** Icons, in the order shown: at most two. */
  icons: BadgeIcon[];
  /** It has more than the icons show: an ellipsis, and the card view lists them all [R]. */
  more: boolean;
  /** Its counters but loyalty, in short: "+2" (+1/+1 counters), "−1" (−1/−1), or the count of another kind. */
  counter: string | null;
  /** A planeswalker's loyalty, its loyalty counters (CR 306.5c), shown where a creature's power/toughness goes. */
  loyalty: number | null;
  /**
   * Summoning sick (CR 302.6) on its controller's turn, when it matters: it can't attack or use {T} abilities. Not shown
   * on the other player's turn, where it can still block and "can't" would mislead.
   */
  sick: boolean;
};

export const NO_BADGES: Badges = { icons: [], more: false, counter: null, loyalty: null, sick: false };

/**
 * The keywords that get an icon, most telling first (what changes combat, then what it can't do). Flash has none: on
 * the battlefield it does nothing. `Record` so a new keyword can't be forgotten here.
 */
const ICON_ORDER: Record<Exclude<Keyword, "flash">, number> = {
  flying: 0,
  reach: 1,
  "first strike": 2,
  "double strike": 2,
  deathtouch: 3,
  trample: 4,
  lifelink: 5,
  vigilance: 6,
  haste: 7,
  indestructible: 8,
  shroud: 9,
  forestwalk: 10,
  swampwalk: 10,
  defender: 11,
};
const PROTECTION_ORDER = 8.5;
/** How many icons fit on a phone's tile beside each other [R: "abbreviated" when there are many]. */
const MOST_ICONS = 2;

export function badgesOf(card: SeenCard, activePlayer: PlayerId | null): Badges {
  const c = card.characteristics;
  const all: { icon: BadgeIcon; order: number }[] = [];
  for (const keyword of c.keywords) {
    if (keyword !== "flash") all.push({ icon: keyword, order: ICON_ORDER[keyword] });
  }
  if (c.protections.length > 0) all.push({ icon: "protection", order: PROTECTION_ORDER });
  all.sort((a, b) => a.order - b.order);
  // Too many to show: one icon and the ellipsis, in the same two places.
  const more = all.length > MOST_ICONS;
  const icons = all.slice(0, more ? MOST_ICONS - 1 : MOST_ICONS).map((a) => a.icon);
  const planeswalker = c.types.includes("planeswalker");
  return {
    icons,
    more,
    counter: counterText(card.counters),
    loyalty: planeswalker ? (card.counters.loyalty ?? 0) : null,
    sick: card.summoningSick && c.controller === activePlayer,
  };
}

/**
 * Its counters in short, loyalty left out (it has its own place): +1/+1 counters as "+n", −1/−1 counters as "−n" (CR
 * 122.1a; the two can't stay together, CR 704.5q), or the count of the first other kind.
 */
function counterText(counters: Record<string, number>): string | null {
  const plus = counters["+1/+1"] ?? 0;
  const minus = counters["-1/-1"] ?? 0;
  if (plus > 0) return `+${plus}`;
  if (minus > 0) return `−${minus}`;
  const other = Object.entries(counters)
    .filter(([kind, n]) => kind !== "loyalty" && n > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))[0];
  return other === undefined ? null : `${other[1]}`;
}
