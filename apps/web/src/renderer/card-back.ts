// The back of a card, for the opponent's hand and the libraries: an original design (D-140), a dark field with a ring
// and a diamond, not any real card back.

import { Container, Graphics, Text } from "pixi.js";
import type { CardBack, LibraryPile } from "../board-model/board-model.ts";
import { PALETTE } from "./palette.ts";

export function cardBackSprite(back: CardBack): Container {
  const root = new Container({ x: back.x + back.width / 2, y: back.y + back.height / 2, rotation: back.rotation });
  root.addChild(backFace(back.width, back.height));
  return root;
}

/** A library: a few backs offset like a pile, its count on a badge (CR 401.3). */
export function librarySprite(pile: LibraryPile): Container {
  const root = new Container({ x: pile.x + pile.width / 2, y: pile.y + pile.height / 2 });
  root.label = pile.mine ? "Your library" : "Opponent's library";
  const layers = Math.min(3, pile.count);
  for (let i = layers - 1; i >= 0; i--) {
    const face = backFace(pile.width, pile.height);
    face.position.set(i * 1.5, -i * 1.5);
    root.addChild(face);
  }
  const text = new Text({
    text: `${pile.count}`,
    style: { fontFamily: "system-ui, sans-serif", fontWeight: "800", fontSize: 11, fill: PALETTE.badgeText },
  });
  text.anchor.set(0.5);
  const bw = Math.max(20, text.width + 8);
  const badge = new Container();
  badge.addChild(
    new Graphics()
      .roundRect(-bw / 2, -8, bw, 16, 8)
      .fill(PALETTE.badge)
      .stroke({ width: 1, color: 0x6b7385 }),
    text,
  );
  // On the part of the pile that's on screen: below the opponent's top edge, above the person's bottom edge.
  badge.position.set(0, pile.mine ? -pile.height / 2 + 12 : pile.height / 2 - 12);
  root.addChild(badge);
  return root;
}

/**
 * Our own card back (D-140): a deep blue field framed by a bronze rim and a fine gold inner line, a ring and a
 * four-pointed star in the middle, a dot at each corner of the inner frame.
 */
function backFace(w: number, h: number): Graphics {
  const r = w * 0.07;
  const rim = Math.max(1.5, w * 0.05);
  const s = Math.min(w, h) * 0.26;
  const inset = rim + Math.max(1.5, w * 0.05);
  const g = new Graphics()
    .roundRect(-w / 2, -h / 2, w, h, r)
    .fill(PALETTE.backRim)
    .roundRect(-w / 2 + rim / 2, -h / 2 + rim / 2, w - rim, h - rim, r * 0.85)
    .stroke({ width: rim * 0.7, color: 0x7a5f34 })
    .roundRect(-w / 2 + rim, -h / 2 + rim, w - 2 * rim, h - 2 * rim, r * 0.7)
    .fill(PALETTE.back)
    .roundRect(-w / 2 + inset, -h / 2 + inset, w - 2 * inset, h - 2 * inset, r * 0.5)
    .stroke({ width: 1, color: 0xc9a55a, alpha: 0.55 })
    .circle(0, 0, s)
    .stroke({ width: Math.max(1, w * 0.025), color: 0xc9a55a, alpha: 0.8 })
    .poly([
      0,
      -s * 0.8,
      s * 0.18,
      -s * 0.18,
      s * 0.8,
      0,
      s * 0.18,
      s * 0.18,
      0,
      s * 0.8,
      -s * 0.18,
      s * 0.18,
      -s * 0.8,
      0,
      -s * 0.18,
      -s * 0.18,
    ])
    .fill({ color: PALETTE.backEmblem, alpha: 0.9 });
  for (const [x, y] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    g.circle(x * (w / 2 - inset), y * (h / 2 - inset), Math.max(1, w * 0.02)).fill({ color: 0xc9a55a, alpha: 0.7 });
  }
  return g;
}
