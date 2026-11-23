// The board's colours, in one place (D-012). Original colours, not Arena's (D-140). Nothing relies on colour alone
// (ui.md, "Never color alone"): a permanent's colours are also glyphs on its name strip, a hand card's are its mana
// cost's symbol shapes, tapped cards carry a tap mark, damage an underline.

import type { Color } from "@mtg/engine";

export const PALETTE = {
  rim: 0x0c0d10,
  parchment: 0xeee8d8,
  ink: 0x1d1a16,
  serif: "Georgia, 'Times New Roman', 'DejaVu Serif', serif",
  artless: 0x1b1f27,
  raised: 0x1f5fbf,
  lowered: 0xc0392b,
  badge: 0x0c0d10,
  badgeText: 0xf4f0e6,
  tapMark: 0xe9e6df,
  playable: 0x3fd4ff,
  picked: 0xffb429,
  attack: 0xd9503a,
  block: 0x6f9fd8,
  back: 0x24304a,
  backRim: 0x0d1220,
  backEmblem: 0x8fa3c9,
} as const;

/** Each colour's frame: the colour of a card's border (CR 105.2 names the five colours). */
export const FRAME: Record<Color, number> = {
  W: 0xd8d3c4,
  U: 0x2f6fb4,
  B: 0x3d3540,
  R: 0xb6452f,
  G: 0x2f7d4a,
};

/** A card's frame colour, from its frame colours: one colour, gold for several, grey for none. */
export function frameColor(colors: readonly Color[]): number {
  if (colors.length > 1) return 0xc9a54a;
  const only = colors[0];
  return only === undefined ? 0x8f949c : FRAME[only];
}

/** The fill of each coloured mana symbol. */
export const MANA_COLORS: Record<Color, number> = {
  W: 0xeee6c9,
  U: 0x4a8fd4,
  B: 0x8a8090,
  R: 0xd65a42,
  G: 0x4d9a5c,
};

export const GENERIC_MANA = 0xc4c0b8;

/** `a` moved `amount` (0 to 1) of the way to `b`, channel by channel. */
export function mix(a: number, b: number, amount: number): number {
  const channel = (shift: number) => {
    const from = (a >> shift) & 0xff;
    const to = (b >> shift) & 0xff;
    return Math.round(from + (to - from) * amount) << shift;
  };
  return channel(16) | channel(8) | channel(0);
}
