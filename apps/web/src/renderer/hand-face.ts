// A hand card below its art, laid out as a printed card (ui.md, "Hand cards are whole cards"): the type line, the
// rules text in a light box, and power/toughness in a box at the bottom right. Our own drawing (D-140).

import { Container, Graphics, Text } from "pixi.js";
import type { BoardCard } from "../board-model/board-model.ts";
import { mix, PALETTE } from "./palette.ts";
import { fitText } from "./text-fit.ts";

/** A hand card below its art, as a printed card: the type line, then the rules text in a light box. */
export function handLower(
  card: BoardCard,
  color: number,
  inner: { x: number; w: number },
  top: number,
  border: number,
): Container {
  const lower = new Container();
  const typeH = Math.max(9, card.height * 0.08);
  const boxY = top + typeH + 1;
  const boxH = card.height / 2 - border - boxY;
  lower.addChild(
    new Graphics()
      .rect(inner.x, top, inner.w, typeH)
      .fill(mix(PALETTE.parchment, color, 0.12))
      .rect(inner.x, boxY, inner.w, boxH)
      .fill(mix(PALETTE.parchment, color, 0.06)),
  );
  const typeLine = new Text({
    text: card.typeLine,
    style: { fontFamily: faceFont(card), fontWeight: "700", fontSize: typeH * 0.68, fill: PALETTE.ink },
  });
  fitText(typeLine, inner.w - 4, { height: typeH });
  typeLine.anchor.set(0, 0.5);
  typeLine.position.set(inner.x + 2, top + typeH / 2);
  lower.addChild(typeLine);
  // The rules text, as large as fits the box: the box is small while the hand is collapsed, larger once it fans open.
  const room = card.power === null ? boxH - 2 : boxH - card.height * 0.11;
  let size = Math.max(4, card.height * 0.055);
  const text = new Text({
    text: card.text,
    style: {
      fontFamily: faceFont(card),
      fontSize: size,
      fill: PALETTE.ink,
      wordWrap: true,
      wordWrapWidth: inner.w - 4,
      lineHeight: size * 1.12,
    },
  });
  while (text.height > room && size > 3) {
    size -= 0.5;
    text.style.fontSize = size;
    text.style.lineHeight = size * 1.12;
  }
  text.position.set(inner.x + 2, boxY + 1.5);
  lower.addChild(text);
  return lower;
}

/** A hand card's power/toughness, in a box at the bottom right as a printed card has it. */
export function ptBox(card: BoardCard, color: number, inner: { x: number; w: number }, border: number): Container {
  const box = new Container();
  const bh = Math.max(10, card.height * 0.1);
  const bw = Math.max(22, card.width * 0.3);
  const x = inner.x + inner.w - bw + 1;
  const y = card.height / 2 - border - bh + 2;
  box.addChild(
    new Graphics()
      .roundRect(x, y, bw, bh, 2)
      .fill(PALETTE.parchment)
      .stroke({ width: 1, color: mix(color, PALETTE.rim, 0.4) }),
  );
  const t = new Text({
    text: `${card.power}/${card.toughness}`,
    style: { fontFamily: "system-ui, sans-serif", fontWeight: "800", fontSize: bh * 0.78, fill: PALETTE.ink },
  });
  t.anchor.set(0.5);
  t.position.set(x + bw / 2, y + bh / 2);
  box.addChild(t);
  return box;
}

/**
 * A drawn card's typeface: a printed card's serif while its real image loads (D-163); an ability's panel, which never
 * gets an image, in the app's own (UX review).
 */
export function faceFont(card: BoardCard): string {
  return card.ability ? PALETTE.sans : PALETTE.serif;
}
