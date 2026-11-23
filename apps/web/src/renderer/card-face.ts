// A card's face off the battlefield (a hand card, an object on the stack): a whole card, drawn in the anatomy of a
// printed card with our own shapes and colours (D-140, D-153): a bevelled frame in the card's colour, a light name
// strip, the art, a type strip and a text box, until the card's real image loads over it. A permanent is a minimal
// tile instead (`battlefield-tile.ts`, D-162). An ability on the stack is the same panel with its source's art in the art
// window and never a whole image over it [R]. All sizes here are proportions of the card the model sized.

import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import type { BoardCard } from "../board-model/board-model.ts";
import { dashed, drawTile } from "./battlefield-tile.ts";
import { ART_LABEL, type Face } from "./face.ts";
import { faceFont, handLower, ptBox } from "./hand-face.ts";
import { type ColorSymbol, colorGlyph, manaCostRow } from "./mana-symbols.ts";
import { FRAME, frameColor, mix, PALETTE } from "./palette.ts";
import { fitText } from "./text-fit.ts";

export function drawFace(card: BoardCard): Face {
  if (card.zone === "battlefield") return drawTile(card);
  const w = card.width;
  const h = card.height;
  const face = new Container();
  const color = frameColor(card);
  const radius = Math.min(w, h) * 0.07;
  const border = Math.max(3, Math.min(w, h) * 0.07);
  // A target (a spell a counterspell can target): the dashed outline a targetable permanent has (D-162), around the part
  // of it that shows (its name strip, under the stack's top), never down the sides of the card over it.
  if (card.targetable) {
    const shows = card.shows?.height ?? h;
    const outline = dashed(w + 4, shows + 4, PALETTE.playable, 2);
    outline.position.set(0, -h / 2 + shows / 2);
    face.addChild(outline);
  }
  // Playable: a thin bright outline, as a permanent's (D-162).
  else if (card.playable) {
    face.addChild(
      new Graphics()
        .roundRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4, radius + 2)
        .stroke({ width: 1.5, color: PALETTE.playable }),
    );
  }
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
  // A multicolour card's gold frame carries a stripe of each of its colours along the top.
  if (card.frameColors.length > 1) face.addChild(colourStripes(card, w, h, border));
  const inner = { x: -w / 2 + border, y: -h / 2 + border, w: w - 2 * border };
  const nameH = Math.max(13, h * 0.1);
  const artBottom = -h / 2 + h * 0.5;
  const top = inner.y + nameH + 1;
  const art = { x: inner.x, y: top, w: inner.w, h: artBottom - top };
  face.addChild(artFallback(card, art));
  face.addChild(new Graphics().rect(art.x, art.y, art.w, art.h).stroke({ width: 1, color: PALETTE.rim, alpha: 0.8 }));
  face.addChild(nameStrip(card, color, inner.x, inner.y, inner.w, nameH));
  face.addChild(handLower(card, color, inner, artBottom, border));
  if (card.power !== null && card.toughness !== null) face.addChild(ptBox(card, color, inner, border));
  // The card's real image covers the drawn card once it loads, under the floating cost.
  const fullLayer = new Container();
  face.addChild(fullLayer);
  if (card.manaCost.length > 0 && card.costRadius > 0) {
    const row = manaCostRow(card.manaCost, card.costRadius);
    // Over the card's top edge, overlapping the frame a little (the owner, ui.md "Mana costs overlap the card").
    row.position.set(-w / 2 + 1, -h / 2 - card.costRadius * 0.45);
    face.addChild(row);
  }
  return {
    container: face,
    showArt: (texture) => {
      // An ability's panel [R]: its source's art in the art window, the panel's own words around it.
      if (card.ability) {
        fullLayer.addChild(artInWindow(texture, art));
        return;
      }
      // The whole card image, unaltered (data-sources.md), its corners rounded as the card's are.
      const sprite = new Sprite(texture);
      sprite.label = ART_LABEL;
      sprite.width = w;
      sprite.height = h;
      sprite.position.set(-w / 2, -h / 2);
      const corners = new Graphics().roundRect(-w / 2, -h / 2, w, h, radius).fill(0xffffff);
      sprite.mask = corners;
      fullLayer.addChild(corners, sprite);
    },
  };
}

type ArtWindow = { x: number; y: number; w: number; h: number };

/** An art crop filling the art window, cropped to it from the centre, never stretched. */
function artInWindow(texture: Texture, art: ArtWindow): Container {
  const holder = new Container();
  const sprite = new Sprite(texture);
  sprite.label = ART_LABEL;
  const scale = Math.max(art.w / texture.width, art.h / texture.height);
  sprite.scale.set(scale);
  sprite.anchor.set(0.5);
  sprite.position.set(art.x + art.w / 2, art.y + art.h / 2);
  const frame = new Graphics().rect(art.x, art.y, art.w, art.h).fill(0xffffff);
  sprite.mask = frame;
  holder.addChild(frame, sprite);
  return holder;
}

/** A thin stripe of each of a multicolour card's colours along the top of its gold frame. */
function colourStripes(card: BoardCard, w: number, h: number, border: number): Graphics {
  const g = new Graphics();
  const n = card.frameColors.length;
  const span = w - 2 * border;
  card.frameColors.forEach((c, i) => {
    g.rect(-w / 2 + border + (i * span) / n, -h / 2 + 1.5, span / n, Math.max(2, border * 0.5)).fill(FRAME[c]);
  });
  return g;
}

/** Until the art loads (or offline): a dark field tinted by the frame, its colour's glyph large in the middle. */
function artFallback(card: BoardCard, art: ArtWindow): Container {
  const holder = new Container();
  const color = frameColor(card);
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
  // A whole card's colours are in its floating mana cost's symbols (never colour alone).
  const room = w - 5;
  const text = new Text({
    text: card.name,
    // A hand card's name is small in its strip (the card's image soon covers it); a panel's is its heading, sized to fit.
    style: {
      fontFamily: faceFont(card),
      fontWeight: "700",
      fontSize: card.ability ? h * 0.62 : Math.min(h * 0.7, 12),
      fill: PALETTE.ink,
    },
  });
  fitText(text, room, { height: h });
  text.anchor.set(0, 0.5);
  text.position.set(x + 3, y + h / 2 + 0.5);
  strip.addChild(text);
  return strip;
}
