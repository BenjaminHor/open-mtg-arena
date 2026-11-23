// The back of a card, for the opponent's hand and the libraries: an original design (D-140), a plain dark field with a
// small ring (D-162), not any real card back.

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
    style: { fontFamily: PALETTE.sans, fontWeight: "700", fontSize: 11, fill: PALETTE.badgeText },
  });
  text.anchor.set(0.5);
  const bw = Math.max(20, text.width + 8);
  const badge = new Container();
  badge.addChild(
    new Graphics()
      .roundRect(-bw / 2, -8, bw, 16, 8)
      .fill(PALETTE.badge)
      .stroke({ width: 1, color: 0xffffff, alpha: 0.18 }),
    text,
  );
  // On the part of the pile that's on screen: below the opponent's top edge, above the person's bottom edge.
  badge.position.set(0, pile.mine ? -pile.height / 2 + 12 : pile.height / 2 - 12);
  root.addChild(badge);
  return root;
}

/**
 * Our own card back (D-140), minimal (D-162): a plain dark field with a thin light edge and a small ring in the middle.
 */
function backFace(w: number, h: number): Graphics {
  const r = Math.min(w, h) * 0.08;
  return new Graphics()
    .roundRect(-w / 2 + 1, -h / 2 + 2, w, h, r)
    .fill({ color: 0x000000, alpha: 0.4 })
    .roundRect(-w / 2, -h / 2, w, h, r)
    .fill(PALETTE.back)
    .stroke({ width: 1, color: 0xffffff, alpha: 0.14 })
    .circle(0, 0, Math.min(w, h) * 0.16)
    .stroke({ width: Math.max(1, w * 0.02), color: 0xffffff, alpha: 0.16 });
}
