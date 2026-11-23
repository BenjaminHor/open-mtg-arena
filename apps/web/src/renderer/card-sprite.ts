// One card drawn on the board, kept by object id and updated in place (the scene moves it; M3-07 will animate the
// move). A battlefield card is mostly art, with a name bar and a power/toughness box [R]; a hand card is a whole card
// with its mana cost floating above it [R]. The look is original (D-140). Art arrives later than the frame and is
// added when it loads; until then (or if it never does) the art window shows the card's colour.

import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import type { BoardCard } from "../board-model/board-model.ts";
import { loadArt } from "./art.ts";
import { manaCostRow } from "./mana-symbols.ts";
import { frameColor, MANA_COLORS, PALETTE } from "./palette.ts";

export type CardSprite = { root: Container; update: (card: BoardCard) => void; destroy: () => void };

export function createCardSprite(card: BoardCard): CardSprite {
  const root = new Container();
  root.label = card.name;
  let drawn = "";
  let alive = true;
  const update = (next: BoardCard) => {
    // The card's centre is its pivot, so a tilt turns it in place.
    root.position.set(next.x + next.width / 2, next.y + next.height / 2);
    root.rotation = next.rotation;
    root.alpha = next.alpha;
    const look = lookKey(next);
    if (look === drawn) return;
    drawn = look;
    for (const child of root.removeChildren()) child.destroy({ children: true, context: true });
    const face = drawFace(next);
    root.addChild(face.container);
    if (next.art !== null) {
      loadArt(next.art).then((texture) => {
        if (alive && drawn === look && texture !== null) face.showArt(texture);
      });
    }
  };
  update(card);
  return {
    root,
    update,
    destroy: () => {
      alive = false;
      root.destroy({ children: true, context: true });
    },
  };
}

/** Everything that changes how the card looks, apart from where it is: a change redraws it. */
function lookKey(c: BoardCard): string {
  return JSON.stringify([
    c.name,
    c.zone,
    c.width,
    c.height,
    c.tapped,
    c.colors,
    c.land,
    c.art,
    c.manaCost,
    c.power,
    c.toughness,
    c.damage,
    c.pileCount,
  ]);
}

function drawFace(card: BoardCard): { container: Container; showArt: (texture: Texture) => void } {
  const w = card.width;
  const h = card.height;
  const face = new Container();
  const radius = w * 0.07;
  const rim = Math.max(1.5, w * 0.035);
  const color = frameColor(card.colors, card.land);
  face.addChild(
    new Graphics()
      .roundRect(-w / 2, -h / 2, w, h, radius)
      .fill(PALETTE.rim)
      .roundRect(-w / 2 + rim / 2, -h / 2 + rim / 2, w - rim, h - rim, radius * 0.8)
      .stroke({ width: rim * 0.8, color }),
  );
  const nameH = Math.max(11, h * (card.zone === "hand" ? 0.1 : 0.16));
  const inner = { x: -w / 2 + rim, y: -h / 2 + rim, w: w - 2 * rim };
  // The art window: under the name bar, the rest of a battlefield card, the upper part of a hand card.
  const art = { x: inner.x, y: inner.y + nameH, w: inner.w, h: card.zone === "hand" ? h * 0.42 : h - 2 * rim - nameH };
  const fallback = new Graphics().rect(art.x, art.y, art.w, art.h).fill(artFallback(card));
  face.addChild(fallback);
  const artLayer = new Container();
  face.addChild(artLayer);
  face.addChild(nameBar(card.name, inner.x, inner.y, inner.w, nameH));
  if (card.zone === "hand") face.addChild(handLower(card, inner, art, rim));
  if (card.power !== null && card.toughness !== null) face.addChild(ptBox(card, w, h, rim));
  if (card.pileCount !== null) face.addChild(pileBadge(card.pileCount, w, h));
  if (card.tapped) face.addChild(tapMark(w));
  if (card.manaCost.length > 0) {
    const r = Math.max(5.5, w * 0.075);
    const row = manaCostRow(card.manaCost, r);
    row.position.set(-w / 2 + 2, -h / 2 - r - 3);
    face.addChild(row);
  }
  return {
    container: face,
    showArt: (texture) => {
      const sprite = new Sprite(texture);
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

function artFallback(card: BoardCard): number {
  const only = card.colors.length === 1 ? card.colors[0] : undefined;
  if (only !== undefined) return MANA_COLORS[only];
  return card.colors.length > 1 ? 0xb8964a : card.land ? 0x7a6c57 : 0x8a9099;
}

function nameBar(name: string, x: number, y: number, w: number, h: number): Container {
  const bar = new Container();
  bar.addChild(new Graphics().rect(x, y, w, h).fill({ color: PALETTE.nameBar, alpha: 0.92 }));
  const text = new Text({
    text: name,
    style: {
      fontFamily: "system-ui, sans-serif",
      fontWeight: "700",
      fontSize: Math.min(h * 0.72, 12),
      fill: PALETTE.nameText,
    },
  });
  fitText(text, name, w - 4);
  text.anchor.set(0, 0.5);
  text.position.set(x + 2.5, y + h / 2);
  bar.addChild(text);
  return bar;
}

/** A hand card's type line strip and text box: blank for now, it fills in when the hand fans open (M3-04b). */
function handLower(
  card: BoardCard,
  inner: { x: number; w: number },
  art: { y: number; h: number },
  rim: number,
): Graphics {
  const typeY = art.y + art.h;
  const typeH = card.height * 0.08;
  const boxY = typeY + typeH;
  return new Graphics()
    .rect(inner.x, typeY, inner.w, typeH)
    .fill(PALETTE.nameBar)
    .rect(inner.x, boxY, inner.w, card.height / 2 - rim - boxY)
    .fill({ color: 0xe8e2d2, alpha: 0.9 });
}

function ptBox(card: BoardCard, w: number, h: number, rim: number): Container {
  const box = new Container();
  const bw = Math.max(22, w * 0.46);
  const bh = Math.max(12, h * 0.17);
  const x = w / 2 - rim - bw + 1;
  const y = h / 2 - rim - bh + 1;
  box.addChild(
    new Graphics()
      .roundRect(x, y, bw, bh, bh * 0.3)
      .fill(PALETTE.ptBox)
      .stroke({ width: 1, color: PALETTE.rim }),
  );
  // Damage shows as lowered toughness in red, as Arena does (arena-research.md); the number is the toughness less the damage marked on it (CR 120.6).
  const toughness = (card.toughness ?? 0) - card.damage;
  const style = { fontFamily: "system-ui, sans-serif", fontWeight: "800" as const, fontSize: bh * 0.8 };
  const p = new Text({ text: `${card.power}/`, style: { ...style, fill: PALETTE.ptText } });
  const t = new Text({
    text: `${toughness}`,
    style: { ...style, fill: card.damage > 0 ? PALETTE.damaged : PALETTE.ptText },
  });
  p.anchor.set(0, 0.5);
  t.anchor.set(0, 0.5);
  const start = x + (bw - p.width - t.width) / 2;
  p.position.set(start, y + bh / 2);
  t.position.set(start + p.width, y + bh / 2);
  box.addChild(p, t);
  return box;
}

function pileBadge(count: number, w: number, h: number): Container {
  const badge = new Container();
  const text = new Text({
    text: `×${count}`,
    style: {
      fontFamily: "system-ui, sans-serif",
      fontWeight: "800",
      fontSize: Math.max(10, w * 0.2),
      fill: PALETTE.badgeText,
    },
  });
  text.anchor.set(0.5);
  const bw = text.width + 8;
  const bh = text.height + 2;
  badge.addChild(
    new Graphics()
      .roundRect(-bw / 2, -bh / 2, bw, bh, bh / 2)
      .fill(PALETTE.badge)
      .stroke({ width: 1, color: 0x6b7385 }),
    text,
  );
  // Straddling the top-right corner, clear of a tapped card's mark.
  badge.position.set(w / 2 - bw / 2 + 4, -h / 2 - 2);
  return badge;
}

/** A curved arrow over a tapped permanent [R]: a shape, so tapped never shows by dimming alone. */
function tapMark(w: number): Graphics {
  const r = w * 0.26;
  const start = -Math.PI * 0.85;
  const end = Math.PI * 0.35;
  const tip = { x: Math.cos(end) * r, y: Math.sin(end) * r };
  const head = r * 0.45;
  // The arrowhead points along the arc's direction at its end.
  const along = end + Math.PI / 2;
  const g = new Graphics();
  for (const [width, color] of [
    [w * 0.12, PALETTE.rim],
    [w * 0.065, PALETTE.tapMark],
  ] as const) {
    g.arc(0, 0, r, start, end).stroke({ width, color, cap: "round" });
    g.poly([
      tip.x + Math.cos(along) * head,
      tip.y + Math.sin(along) * head,
      tip.x + Math.cos(along + 2.4) * head * 0.8,
      tip.y + Math.sin(along + 2.4) * head * 0.8,
      tip.x + Math.cos(along - 2.4) * head * 0.8,
      tip.y + Math.sin(along - 2.4) * head * 0.8,
    ]).fill(color);
  }
  return g;
}

/** Shortens the text with an ellipsis until it fits the width. */
function fitText(text: Text, full: string, width: number): void {
  if (text.width <= width) return;
  let shown = full;
  while (shown.length > 1 && text.width > width) {
    shown = shown.slice(0, -1);
    text.text = `${shown.trimEnd()}…`;
  }
}
