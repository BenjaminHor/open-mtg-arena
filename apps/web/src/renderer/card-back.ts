// The back of a card, for the opponent's hand: an original design (D-140), a plain dark field with a
// small ring (D-162), not any real card back.

import { Container, Graphics } from "pixi.js";
import type { CardBack } from "../board-model/board-model.ts";
import { PALETTE } from "./palette.ts";

export function cardBackSprite(back: CardBack): Container {
  const root = new Container({ x: back.x + back.width / 2, y: back.y + back.height / 2, rotation: back.rotation });
  root.addChild(backFace(back.width, back.height));
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
