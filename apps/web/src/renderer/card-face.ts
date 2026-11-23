// A card's face, drawn in the anatomy of Arena's cards (ui.md, "The cards"; D-153) with our own shapes and colours
// (D-140): a bevelled frame in the card's colour with a shadow under it, a light name strip across the top, the art
// filling the rest, power/toughness in a light pill at the bottom centre over the frame's edge. A hand card is a whole
// card: the same frame and name strip, the art, a type strip and a text box. All sizes here are proportions of the
// card the model sized; where things go on the board is the model's business.

import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import type { BoardCard } from "../board-model/board-model.ts";
import { type ColorSymbol, colorGlyph, manaCostRow } from "./mana-symbols.ts";
import { FRAME, frameColor, mix, PALETTE } from "./palette.ts";

export const ART_LABEL = "art";

export type Face = { container: Container; showArt: (texture: Texture) => void };

export function drawFace(card: BoardCard): Face {
  const w = card.width;
  const h = card.height;
  const face = new Container();
  const color = frameColor(card.frameColors);
  const radius = Math.min(w, h) * 0.07;
  const border = Math.max(3, Math.min(w, h) * 0.07);
  // The shadow on the table, then the frame: a dark edge, the colour, a light bevel inside it.
  face.addChild(
    new Graphics()
      .roundRect(-w / 2 + 1.5, -h / 2 + 2.5, w, h, radius)
      .fill({ color: 0x000000, alpha: 0.45 })
      .roundRect(-w / 2, -h / 2, w, h, radius)
      .fill(PALETTE.rim)
      .roundRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2, radius * 0.9)
      .fill(color)
      .roundRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, radius * 0.8)
      .stroke({ width: 1, color: mix(color, 0xffffff, 0.45) }),
  );
  const inner = { x: -w / 2 + border, y: -h / 2 + border, w: w - 2 * border };
  const nameH = Math.max(13, h * (card.zone === "hand" ? 0.1 : 0.17));
  const artBottom = card.zone === "hand" ? -h / 2 + h * 0.56 : h / 2 - border;
  const art = { x: inner.x, y: inner.y + nameH + 1, w: inner.w, h: artBottom - (inner.y + nameH + 1) };
  const fallback = artFallback(card, art);
  face.addChild(fallback);
  const artLayer = new Container();
  face.addChild(artLayer);
  face.addChild(new Graphics().rect(art.x, art.y, art.w, art.h).stroke({ width: 1, color: PALETTE.rim, alpha: 0.8 }));
  if (card.behind) {
    // A card behind a pile's front shows only its edge: no strip or badges to clutter the pile.
    face.addChild(new Graphics().rect(inner.x, inner.y, inner.w, nameH).fill(mix(color, PALETTE.parchment, 0.6)));
  } else {
    face.addChild(nameStrip(card, color, inner.x, inner.y, inner.w, nameH));
    if (card.zone === "hand") face.addChild(handLower(card, color, inner, artBottom, border));
    if (card.power !== null && card.toughness !== null) face.addChild(ptPill(card, color, h));
  }
  if (card.dim > 0) {
    face.addChild(new Graphics().roundRect(-w / 2, -h / 2, w, h, radius).fill({ color: 0x000000, alpha: card.dim }));
  }
  if (card.tapped && !card.behind) face.addChild(tapMark(Math.min(w, h)));
  if (card.pileCount !== null) face.addChild(pileBadge(card.pileCount, w, h));
  if (card.manaCost.length > 0 && card.costRadius > 0) {
    const row = manaCostRow(card.manaCost, card.costRadius);
    row.position.set(-w / 2 + 1, -h / 2 - card.costRadius - 2);
    face.addChild(row);
  }
  return {
    container: face,
    showArt: (texture) => {
      const sprite = new Sprite(texture);
      sprite.label = ART_LABEL;
      // Cover the window, keeping the art's shape, centred; the mask trims what's outside it.
      const scale = Math.max(art.w / texture.width, art.h / texture.height);
      sprite.scale.set(scale);
      sprite.position.set(art.x + (art.w - texture.width * scale) / 2, art.y + (art.h - texture.height * scale) / 2);
      const mask = new Graphics().rect(art.x, art.y, art.w, art.h).fill(0xffffff);
      sprite.mask = mask;
      artLayer.addChild(mask, sprite);
      fallback.visible = false;
    },
  };
}

/** Until the art loads (or offline): a dark field tinted by the frame, its colour's glyph large in the middle. */
function artFallback(card: BoardCard, art: { x: number; y: number; w: number; h: number }): Container {
  const holder = new Container();
  const color = frameColor(card.frameColors);
  holder.addChild(new Graphics().rect(art.x, art.y, art.w, art.h).fill(mix(PALETTE.artless, color, 0.28)));
  const first = card.frameColors[0];
  if (first !== undefined) {
    const glyph = colorGlyph(first as ColorSymbol, Math.min(art.w, art.h) * 0.3, mix(color, 0xffffff, 0.15));
    glyph.alpha = 0.55;
    glyph.position.set(art.x + art.w / 2, art.y + art.h / 2);
    holder.addChild(glyph);
  }
  return holder;
}

/** The name strip: dark serif text on light, the card's colours as glyphs at its right end (never colour alone). */
function nameStrip(card: BoardCard, color: number, x: number, y: number, w: number, h: number): Container {
  const strip = new Container();
  strip.addChild(
    new Graphics()
      .rect(x, y, w, h)
      .fill(mix(PALETTE.parchment, color, 0.12))
      .moveTo(x, y + h)
      .lineTo(x + w, y + h)
      .stroke({ width: 1, color: PALETTE.rim, alpha: 0.6 }),
  );
  const glyphR = h * 0.34;
  // A hand card's colours are in its floating mana cost; a permanent shows them here.
  const glyphs = card.zone === "battlefield" ? card.colors : [];
  glyphs.forEach((c, i) => {
    const g = colorGlyph(c as ColorSymbol, glyphR, FRAME[c]);
    g.position.set(x + w - glyphR - 2 - i * (glyphR * 2 + 1), y + h / 2);
    strip.addChild(g);
  });
  const room = w - 5 - glyphs.length * (glyphR * 2 + 1);
  const text = new Text({
    text: card.name,
    style: { fontFamily: PALETTE.serif, fontWeight: "700", fontSize: Math.min(h * 0.7, 12), fill: PALETTE.ink },
  });
  fitText(text, card.name, room);
  text.anchor.set(0, 0.5);
  text.position.set(x + 3, y + h / 2 + 0.5);
  strip.addChild(text);
  return strip;
}

/** A hand card below its art: the type strip and the text box, blank until the hand fans open (M3-04b). */
function handLower(
  card: BoardCard,
  color: number,
  inner: { x: number; w: number },
  top: number,
  border: number,
): Graphics {
  const typeH = card.height * 0.08;
  return new Graphics()
    .rect(inner.x, top, inner.w, typeH)
    .fill(mix(PALETTE.parchment, color, 0.12))
    .rect(inner.x, top + typeH + 1, inner.w, card.height / 2 - border - (top + typeH + 1))
    .fill(mix(PALETTE.parchment, color, 0.06));
}

/**
 * Power/toughness in a pill at the bottom centre. A raised number is blue, a lowered one red, and damage also
 * underlines the toughness, a shape, so it doesn't rest on colour alone. The toughness shown is less the damage marked
 * on the creature (CR 120.6), as Arena shows it.
 */
function ptPill(card: BoardCard, color: number, h: number): Container {
  const pill = new Container();
  const ph = Math.max(13, h * 0.2);
  const pw = Math.max(30, card.width * 0.36);
  const y = h / 2 - ph / 2 - 1;
  pill.addChild(
    new Graphics()
      .roundRect(-pw / 2, y - ph / 2, pw, ph, ph / 2)
      .fill(PALETTE.parchment)
      .stroke({ width: 1.5, color: mix(color, PALETTE.rim, 0.4) }),
  );
  const toughness = (card.toughness ?? 0) - card.damage;
  const tint = (now: number | null, printed: number | null, hurt: boolean) =>
    hurt || (now !== null && printed !== null && now < printed)
      ? PALETTE.lowered
      : now !== null && printed !== null && now > printed
        ? PALETTE.raised
        : PALETTE.ink;
  const style = { fontFamily: "system-ui, sans-serif", fontWeight: "800" as const, fontSize: ph * 0.78 };
  const p = new Text({ text: `${card.power}`, style: { ...style, fill: tint(card.power, card.printed.power, false) } });
  const slash = new Text({ text: "/", style: { ...style, fill: PALETTE.ink } });
  const t = new Text({
    text: `${toughness}`,
    style: { ...style, fill: tint(toughness, card.printed.toughness, card.damage > 0) },
  });
  const width = p.width + slash.width + t.width;
  let x = -width / 2;
  for (const part of [p, slash, t]) {
    part.anchor.set(0, 0.5);
    part.position.set(x, y);
    x += part.width;
  }
  pill.addChild(p, slash, t);
  if (card.damage > 0) {
    pill.addChild(new Graphics().rect(t.x, y + ph * 0.32, t.width, Math.max(1.5, ph * 0.1)).fill(PALETTE.lowered));
  }
  return pill;
}

/** "x4" above a pile's front card, at its top left, as Arena counts a pile of tokens. */
function pileBadge(count: number, w: number, h: number): Container {
  const badge = new Container();
  const text = new Text({
    text: `x${count}`,
    style: { fontFamily: "system-ui, sans-serif", fontWeight: "800", fontSize: 11, fill: PALETTE.badgeText },
  });
  text.anchor.set(0.5);
  const bw = text.width + 8;
  const bh = text.height + 1;
  badge.addChild(
    new Graphics()
      .roundRect(-bw / 2, -bh / 2, bw, bh, 3)
      .fill(PALETTE.badge)
      .stroke({ width: 1, color: 0x6b7385 }),
    text,
  );
  // Above the card's top-left corner, clear of its name.
  badge.position.set(-w / 2 + bw / 2, -h / 2 - bh / 2 + 2);
  return badge;
}

/** A large curved arrow over a tapped permanent [R], light with a dark edge: tapped shows by shape, not by shade. */
function tapMark(size: number): Graphics {
  const r = size * 0.27;
  const start = -Math.PI * 0.95;
  const end = Math.PI * 0.4;
  const tip = { x: Math.cos(end) * r, y: Math.sin(end) * r };
  const head = r * 0.55;
  const along = end + Math.PI / 2;
  const g = new Graphics();
  for (const [width, color, alpha] of [
    [size * 0.13, PALETTE.rim, 0.7],
    [size * 0.08, PALETTE.tapMark, 0.85],
  ] as const) {
    g.arc(0, 0, r, start, end).stroke({ width, color, alpha, cap: "round" });
    g.poly([
      tip.x + Math.cos(along) * head,
      tip.y + Math.sin(along) * head,
      tip.x + Math.cos(along + 2.3) * head * 0.85,
      tip.y + Math.sin(along + 2.3) * head * 0.85,
      tip.x + Math.cos(along - 2.3) * head * 0.85,
      tip.y + Math.sin(along - 2.3) * head * 0.85,
    ]).fill({ color, alpha });
  }
  return g;
}

/** Shortens the text with an ellipsis until it fits the width. */
function fitText(text: Text, full: string, width: number): void {
  let shown = full;
  while (shown.length > 1 && text.width > width) {
    shown = shown.slice(0, -1);
    text.text = `${shown.trimEnd()}…`;
  }
}
