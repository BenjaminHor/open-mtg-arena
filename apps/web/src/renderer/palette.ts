// The board's colours, in one place (D-012). Original colours, not Arena's (D-140). Nothing relies on colour alone
// (ui.md, "Never color alone"): a card's colour is also in its mana symbols' shapes, tapped cards carry a tap mark.

import type { Color } from "@mtg/engine";

export const PALETTE = {
  band: 0x232833,
  rim: 0x0c0d10,
  nameBar: 0x15171c,
  nameText: 0xf4f0e6,
  ptBox: 0xf1ebdc,
  ptText: 0x16181d,
  damaged: 0xc0392b,
  badge: 0x0c0d10,
  badgeText: 0xf4f0e6,
  tapMark: 0xffffff,
  back: 0x24304a,
  backRim: 0x0d1220,
  backEmblem: 0x8fa3c9,
} as const;

/** A card's frame colour, from its colours (CR 105.2): one colour, gold for several, grey for none, earth for a land. */
export function frameColor(colors: readonly Color[], land: boolean): number {
  if (colors.length > 1) return 0xc9a54a;
  const only = colors[0];
  if (only === undefined) return land ? 0x8b7b63 : 0x9aa1ab;
  return MANA_COLORS[only];
}

/** The fill of each coloured mana symbol, and of the art window when a card has no art yet. */
export const MANA_COLORS: Record<Color, number> = {
  W: 0xeee6c9,
  U: 0x4a8fd4,
  B: 0x5b5260,
  R: 0xd65a42,
  G: 0x4d9a5c,
};

export const GENERIC_MANA = 0xc4c0b8;
