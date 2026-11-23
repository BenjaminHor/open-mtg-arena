// A permanent on the battlefield, drawn minimal and clean (D-162): only its art, its corners rounded, no frame or name
// strip. Its name sits in small white text over a dark fade at the art's bottom, and its power/toughness in a small
// dark pill at the bottom right. A token's art rises into an arch at the top, so a token reads as one by its shape.
// With no art (a token, offline, before it loads) the tile is filled in the card's colour with its colours' glyphs:
// the art otherwise says what colour a card is, and the card view says it in words (ui.md, "Never color alone").

import { Container, FillGradient, Graphics, Sprite, Text } from "pixi.js";
import type { BoardCard } from "../board-model/board-model.ts";
import { combatBadge, tapMark } from "./card-marks.ts";
import { ART_LABEL, type Face } from "./face.ts";
import { type ColorSymbol, colorGlyph } from "./mana-symbols.ts";
import { frameColor, mix, PALETTE } from "./palette.ts";
import { fitText } from "./text-fit.ts";

/** The name's size at most, in CSS px. */
const NAME_SIZE = 11;

export function drawTile(card: BoardCard): Face {
  const w = card.width;
  const h = card.height;
  const tile = new Container();
  const radius = Math.min(w, h) * 0.08;
  const shape = card.token ? arched(w, h, radius) : (g: Graphics) => g.roundRect(-w / 2, -h / 2, w, h, radius);
  // The state around it: a solid outline where it can be used now, a thicker yellow-orange one for a pick (which also
  // carries its combat badge). Two widths and, for a pick, a badge: never the hue alone.
  if (card.picked) tile.addChild(outline(shape, w, h, PALETTE.picked, 2.5));
  else if (card.playable && !card.behind) tile.addChild(outline(shape, w, h, PALETTE.playable, 1.5));
  // Its shadow on the table, then the art's field.
  tile.addChild(
    new Graphics().roundRect(-w / 2 + 1, -h / 2 + 2, w, h, radius).fill({ color: 0x000000, alpha: 0.45 }),
    fallback(card, shape, w, h),
  );
  const artLayer = new Container();
  tile.addChild(artLayer);
  if (!card.behind) tile.addChild(...nameAndStats(card, w, h));
  tile.addChild(shape(new Graphics()).stroke({ width: 1, color: PALETTE.rim, alpha: 0.9 }));
  if (card.dim > 0) tile.addChild(shape(new Graphics()).fill({ color: 0x000000, alpha: card.dim }));
  // An attacker's swords say more than a tap mark would, so it has only the tilt and the swords.
  if (card.tapped && !card.behind && !card.attacking) {
    const mark = tapMark(Math.min(w, h) * 0.78);
    mark.y = -h * 0.08;
    tile.addChild(mark);
  }
  if (card.attacking || card.blocking.length > 0) tile.addChild(combatBadge(card.attacking ? "attack" : "block", w, h));
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
function arched(w: number, h: number, radius: number): (g: Graphics) => Graphics {
  const rise = h * 0.12;
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

function outline(shape: (g: Graphics) => Graphics, w: number, h: number, color: number, width: number): Graphics {
  const g = new Graphics();
  // Drawn a little larger than the tile, so it stands just outside the art.
  const grow = (w + 2 * (width + 1)) / w;
  shape(g).stroke({ width, color, alignment: 0 });
  g.scale.set(grow, (h + 2 * (width + 1)) / h);
  return g;
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
 * ui.md "Name and P/T on one line"): a long name is squeezed and shrunk to fit beside the pill, never cut off and never
 * moved to a line of its own.
 */
function nameAndStats(card: BoardCard, w: number, h: number): Container[] {
  const pad = Math.max(2, w * 0.03);
  const pill = card.power !== null && card.toughness !== null ? ptPill(card, h) : null;
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
  fitText(name, w - 2 * pad - (pill === null ? 0 : pill.width + pad), { oneLine: true });
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
  const size = Math.min(11, Math.max(8, h * 0.15));
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
