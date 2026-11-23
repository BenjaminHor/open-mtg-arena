// A permanent on the battlefield, drawn minimal and clean (D-162): only its art, its corners rounded, no frame or name
// strip. Its name sits in small white text over a dark fade at the art's bottom, and its power/toughness in a small
// dark pill at the bottom right. A token's art rises into an arch at the top, so a token reads as one by its shape.
// With no art (a token, offline, before it loads) the tile is filled in the card's colour with its colours' glyphs:
// the art otherwise says what colour a card is, and the card view says it in words (ui.md, "Never color alone").

import { Container, FillGradient, Graphics, Sprite, Text } from "pixi.js";
import type { BoardCard } from "../board-model/board-model.ts";
import { counterBadge, iconRow, linkMark, loyaltyShield } from "./badge-marks.ts";
import { combatBadge, combatBadgeRadius, tapMark } from "./card-marks.ts";
import { ART_LABEL, type Face } from "./face.ts";
import { type ColorSymbol, colorGlyph } from "./mana-symbols.ts";
import { frameColor, mix, PALETTE } from "./palette.ts";

/** The name's size at most, in CSS px: it grows with the tile up to this (a desktop's tiles are twice a phone's). */
const NAME_SIZE = 14;
/** The smallest a name shrinks to, still readable on a phone; past it, it fades out at the pill. */
const NAME_SMALLEST = 7;

export function drawTile(card: BoardCard): Face {
  const w = card.width;
  const h = card.height;
  const tile = new Container();
  const radius = Math.min(w, h) * 0.08;
  const shape = card.token ? arched(w, h, radius) : (g: Graphics) => g.roundRect(-w / 2, -h / 2, w, h, radius);
  // Its shadow on the table, then the art's field.
  tile.addChild(
    new Graphics().roundRect(-w / 2 + 1, -h / 2 + 2, w, h, radius).fill({ color: 0x000000, alpha: 0.45 }),
    fallback(card, shape, w, h),
  );
  const artLayer = new Container();
  tile.addChild(artLayer);
  // A tapped or sick card's art is dimmed; its name and P/T stay as readable as any card's (drawn after).
  if (card.dim > 0) tile.addChild(shape(new Graphics()).fill({ color: 0x000000, alpha: card.dim }));
  if (!card.behind) tile.addChild(...nameAndStats(card, w, h));
  tile.addChild(shape(new Graphics()).stroke({ width: 1, color: PALETTE.rim, alpha: 0.9 }));
  // Its state, on its own edge (inside it, so neighbours' outlines never touch): a solid outline where it can be used
  // now, a thicker yellow-orange one for a pick (which also carries its combat badge), a dashed one where it can be
  // targeted, as a targetable player's. Widths, a badge and a dash: never the hue alone.
  if (card.picked) tile.addChild(outline(shape, w, h, PALETTE.picked, 2.5));
  else if (card.targetable && !card.behind) tile.addChild(dashed(w, h, PALETTE.playable, 2));
  else if (card.playable && !card.behind) tile.addChild(outline(shape, w, h, PALETTE.playable, 1.5));
  // An attacker's swords say more than a tap mark would, so it has only the tilt and the swords.
  if (card.tapped && !card.behind && !card.attacking) {
    const mark = tapMark(Math.min(w, h) * 0.78);
    mark.y = -h * 0.08;
    tile.addChild(mark);
  }
  const inCombat = card.attacking || card.blocking.length > 0;
  if (inCombat) tile.addChild(combatBadge(card.attacking ? "attack" : "block", w, h));
  // Over the dimming of a tapped or sick card: its badges stay bright, the thing still worth reading.
  if (!card.behind) tile.addChild(...badgeMarks(card, w, h, inCombat));
  // What's attached to it peeks out at its left (board-model/attachments.ts): a link mark joins them.
  if (card.attachments > 0) {
    const link = linkMark(Math.min(9, Math.max(6, Math.min(w, h) * 0.09)));
    link.position.set(-w / 2, 0);
    tile.addChild(link);
  }
  return {
    container: tile,
    showArt: (texture) => {
      // Cover the tile, keeping the art's shape, centred; the tile's shape trims what's outside it.
      const sprite = new Sprite(texture);
      sprite.label = ART_LABEL;
      const scale = Math.max(w / texture.width, h / texture.height);
      sprite.scale.set(scale);
      sprite.position.set(-(texture.width * scale) / 2, -(texture.height * scale) / 2);
      const mask = shape(new Graphics()).fill(0xffffff);
      sprite.mask = mask;
      artLayer.addChild(mask, sprite);
    },
  };
}

/** A token's tile: a rounded rectangle whose top rises into an arch. */
/** How far (of the tile's height) a token's arched top dips at its corners: badges there sit below it. */
const TOKEN_ARCH_RISE = 0.12;

function arched(w: number, h: number, radius: number): (g: Graphics) => Graphics {
  const rise = h * TOKEN_ARCH_RISE;
  return (g) =>
    g
      .moveTo(-w / 2, -h / 2 + rise)
      .quadraticCurveTo(0, -h / 2 - rise * 0.9, w / 2, -h / 2 + rise)
      .lineTo(w / 2, h / 2 - radius)
      .quadraticCurveTo(w / 2, h / 2, w / 2 - radius, h / 2)
      .lineTo(-w / 2 + radius, h / 2)
      .quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - radius)
      .closePath();
}

/** The tile's own shape stroked just inside its edge. */
function outline(shape: (g: Graphics) => Graphics, w: number, h: number, color: number, width: number): Graphics {
  const g = shape(new Graphics()).stroke({ width, color });
  g.scale.set((w - width) / w, (h - width) / h);
  return g;
}

/** A dashed outline just inside the tile's edge: dashes along each side, the corners left open. */
function dashed(w: number, h: number, color: number, width: number): Graphics {
  const g = new Graphics();
  const dash = 5;
  const gap = 3.5;
  const x0 = -w / 2 + width / 2;
  const y0 = -h / 2 + width / 2;
  const x1 = w / 2 - width / 2;
  const y1 = h / 2 - width / 2;
  const corner = Math.min(w, h) * 0.08;
  const side = (ax: number, ay: number, bx: number, by: number) => {
    const length = Math.hypot(bx - ax, by - ay);
    for (let t = 0; t < length; t += dash + gap) {
      const end = Math.min(length, t + dash);
      g.moveTo(ax + ((bx - ax) * t) / length, ay + ((by - ay) * t) / length).lineTo(
        ax + ((bx - ax) * end) / length,
        ay + ((by - ay) * end) / length,
      );
    }
  };
  side(x0 + corner, y0, x1 - corner, y0);
  side(x1, y0 + corner, x1, y1 - corner);
  side(x1 - corner, y1, x0 + corner, y1);
  side(x0, y1 - corner, x0, y0 + corner);
  return g.stroke({ width, color, cap: "round" });
}

/** Before the art loads, or without any: the card's colour, darkened, with its colours' glyphs in the middle. */
function fallback(card: BoardCard, shape: (g: Graphics) => Graphics, w: number, h: number): Container {
  const field = new Container();
  const color = frameColor(card);
  field.addChild(shape(new Graphics()).fill(mix(PALETTE.artless, color, 0.4)));
  const r = Math.min(w, h) * 0.13;
  const colors = card.frameColors;
  colors.forEach((c, i) => {
    const glyph = colorGlyph(c as ColorSymbol, r, mix(color, 0xffffff, 0.3));
    glyph.alpha = 0.7;
    glyph.position.set((i - (colors.length - 1) / 2) * r * 2.4, -h * 0.12);
    field.addChild(glyph);
  });
  return field;
}

/**
 * The name over a dark fade at the bottom, and the power/toughness pill at the bottom right, on one line (the owner,
 * ui.md "Name and P/T on one line"). A long name shrinks, at its letters' natural width, down to a readable
 * `NAME_SMALLEST`; one that still doesn't fit fades out at the pill (the owner, ui.md "Long names"), its whole name in
 * the card view.
 */
function nameAndStats(card: BoardCard, w: number, h: number): Container[] {
  const pad = Math.max(2, w * 0.03);
  // A creature's power/toughness, or a planeswalker's loyalty in its place [R].
  const loyalty = card.badges.loyalty;
  const pill = hasPowerToughness(card)
    ? ptPill(card, h)
    : loyalty !== null
      ? // Its numeral as large as a creature's P/T: a planeswalker's most important number.
        loyaltyShield(loyalty, Math.min(14, Math.max(8, h * 0.15)) * 1.7)
      : null;
  const name = new Text({
    text: card.name,
    style: {
      fontFamily: PALETTE.sans,
      fontWeight: "500",
      fontSize: Math.min(NAME_SIZE, Math.max(8, h * 0.15)),
      fill: 0xffffff,
      // Readable over bright art too.
      dropShadow: { color: 0x000000, alpha: 0.85, blur: 2, distance: 0, angle: 0 },
    },
  });
  const lineH = name.height;
  const room = w - 2 * pad - (pill === null ? 0 : pill.width + pad);
  let size = Number(name.style.fontSize);
  while (name.width > room && size > NAME_SMALLEST) {
    size = Math.max(NAME_SMALLEST, size - 0.5);
    name.style.fontSize = size;
  }
  const overflows = name.width > room;
  // On the pill's line: centred on it when there is one.
  const lineMiddle = h / 2 - pad - (pill === null ? lineH : pill.height) / 2;
  name.anchor.set(0, 0.5);
  name.position.set(-w / 2 + pad, lineMiddle);
  // The fade: dark at the bottom edge, clear a little above the line.
  const fadeTop = lineMiddle - Math.max(lineH, pill?.height ?? 0) / 2 - pad * 2.5;
  const fade = new Graphics().rect(-w / 2, fadeTop, w, h / 2 - fadeTop).fill(
    new FillGradient({
      type: "linear",
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: "rgba(0,0,0,0)" },
        { offset: 1, color: "rgba(0,0,0,0.78)" },
      ],
      textureSpace: "local",
    }),
  );
  const mask = new Graphics().roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.08).fill(0xffffff);
  fade.mask = mask;
  const parts: Container[] = [mask, fade, name];
  if (overflows) {
    // Cut at the pill, its last few pixels fading into the dark under the name.
    const clip = new Graphics().rect(-w / 2 + pad, lineMiddle - lineH, room, lineH * 2).fill(0xffffff);
    name.mask = clip;
    const tail = Math.min(12, room * 0.3);
    const fadeOut = new Graphics().rect(-w / 2 + pad + room - tail, lineMiddle - lineH / 2, tail, lineH).fill(
      new FillGradient({
        type: "linear",
        start: { x: 0, y: 0 },
        end: { x: 1, y: 0 },
        colorStops: [
          { offset: 0, color: "rgba(0,0,0,0)" },
          { offset: 1, color: "rgba(0,0,0,0.85)" },
        ],
        textureSpace: "local",
      }),
    );
    parts.push(clip, fadeOut);
  }
  if (pill !== null) {
    pill.position.set(w / 2 - pad - pill.width, h / 2 - pad - pill.height);
    parts.push(pill);
  }
  return parts;
}

/** On the dark pill, a raised number is a light blue and a lowered one a light red; damage also underlines it. */
const RAISED = 0x7cb8ff;
const LOWERED = 0xff8a7a;

/**
 * Power/toughness in a small dark pill. The toughness shown is less the damage marked on the creature (CR 120.6), as
 * Arena shows it, and then underlined: a shape, so it doesn't rest on colour alone.
 */
function ptPill(card: BoardCard, h: number): Container {
  const pill = new Container();
  const size = Math.min(14, Math.max(8, h * 0.15));
  const style = { fontFamily: PALETTE.sans, fontWeight: "600" as const, fontSize: size };
  const toughness = (card.toughness ?? 0) - card.damage;
  const tint = (now: number | null, printed: number | null, hurt: boolean) =>
    hurt || (now !== null && printed !== null && now < printed)
      ? LOWERED
      : now !== null && printed !== null && now > printed
        ? RAISED
        : 0xffffff;
  const p = new Text({ text: `${card.power}`, style: { ...style, fill: tint(card.power, card.printed.power, false) } });
  const slash = new Text({ text: "/", style: { ...style, fill: 0xffffff } });
  const t = new Text({
    text: `${toughness}`,
    style: { ...style, fill: tint(toughness, card.printed.toughness, card.damage > 0) },
  });
  const padX = size * 0.3;
  const pw = p.width + slash.width + t.width + 2 * padX;
  const ph = size * 1.35;
  pill.addChild(
    new Graphics()
      .roundRect(0, 0, pw, ph, size * 0.35)
      .fill({ color: 0x0b0c0e, alpha: 0.85 })
      .stroke({ width: 1, color: 0xffffff, alpha: 0.18 }),
  );
  let x = padX;
  for (const part of [p, slash, t]) {
    part.anchor.set(0, 0.5);
    part.position.set(x, ph / 2);
    x += part.width;
    pill.addChild(part);
  }
  if (card.damage > 0) {
    pill.addChild(new Graphics().rect(t.x, ph / 2 + size * 0.5, t.width, Math.max(1.2, size * 0.1)).fill(LOWERED));
  }
  return pill;
}

/**
 * Its badges (board-model/badges.ts): counters at the top right, left of a combat badge when there is one, and the
 * icons along the top left in what room the counter leaves (fewer, with the ellipsis, when they don't fit). Below a
 * token's arch at the corners. A planeswalker's loyalty is drawn in the P/T's place (`nameAndStats`); one that's also a
 * creature (none in today's pool) would show only its P/T there, its loyalty in the card view.
 */
function badgeMarks(card: BoardCard, w: number, h: number, inCombat: boolean): Container[] {
  const { badges } = card;
  const r = Math.min(13, Math.max(6, Math.min(w, h) * 0.1));
  const inset = Math.max(2, r * 0.35);
  const top = -h / 2 + inset + (card.token ? h * TOKEN_ARCH_RISE : 0);
  const marks: Container[] = [];
  let free = w / 2 - inset - (inCombat ? combatBadgeRadius(h) * 2 : 0);
  if (badges.counter !== null) {
    const counter = counterBadge(badges.counter, r * 2);
    counter.position.set(free, top);
    marks.push(counter);
    free -= counter.width + 2;
  }
  const left = -w / 2 + inset;
  const row = iconRow(badges, r, Math.floor((free - left + 2) / (r * 2 + 2)));
  row.position.set(left, top);
  marks.push(row);
  return marks;
}

function hasPowerToughness(card: BoardCard): boolean {
  return card.power !== null && card.toughness !== null;
}
