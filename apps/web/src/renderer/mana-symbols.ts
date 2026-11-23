// Mana symbols (CR 107.4) as shapes, never colour alone (ui.md): each coloured symbol has its own glyph, drawn here
// as simple original vector shapes (D-140): a sun for white, a drop for blue, a crescent for black, a flame for red, a
// tree for green. Generic mana and X are numbers or letters on grey.

import { Container, Graphics, Text } from "pixi.js";
import { GENERIC_MANA, MANA_COLORS } from "./palette.ts";

const GLYPH = 0x1a1a1a;

/** One symbol, centred on (0, 0), `r` its radius. */
export function manaSymbol(symbol: string, r: number): Container {
  const holder = new Container();
  const color = isColor(symbol) ? MANA_COLORS[symbol] : GENERIC_MANA;
  holder.addChild(
    new Graphics()
      .circle(0, 0, r)
      .fill(color)
      .stroke({ width: Math.max(1, r * 0.18), color: 0x0c0d10 }),
  );
  if (isColor(symbol)) holder.addChild(glyph(symbol, r));
  else {
    const text = new Text({
      text: symbol,
      style: { fontFamily: "system-ui, sans-serif", fontWeight: "800", fontSize: r * 1.45, fill: GLYPH },
    });
    text.anchor.set(0.5, 0.52);
    holder.addChild(text);
  }
  return holder;
}

/** A row of symbols, its left edge at x = 0 and its centre line at y = 0. */
export function manaCostRow(symbols: readonly string[], r: number): Container {
  const row = new Container();
  symbols.forEach((s, i) => {
    const sym = manaSymbol(s, r);
    sym.position.set(r + i * r * 2.05, 0);
    row.addChild(sym);
  });
  return row;
}

type ColorSymbol = keyof typeof MANA_COLORS;

function isColor(symbol: string): symbol is ColorSymbol {
  return Object.hasOwn(MANA_COLORS, symbol);
}

function glyph(symbol: ColorSymbol, r: number): Graphics {
  const g = new Graphics();
  const s = r * 0.62;
  switch (symbol) {
    case "W": {
      // A sun: a disc and eight short rays.
      g.circle(0, 0, s * 0.42).fill(GLYPH);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        g.moveTo(Math.cos(a) * s * 0.62, Math.sin(a) * s * 0.62).lineTo(Math.cos(a) * s, Math.sin(a) * s);
      }
      return g.stroke({ width: Math.max(1, s * 0.2), color: GLYPH, cap: "round" });
    }
    case "U":
      // A drop.
      return g
        .moveTo(0, -s)
        .bezierCurveTo(s * 0.35, -s * 0.4, s * 0.75, 0, s * 0.75, s * 0.3)
        .arc(0, s * 0.3, s * 0.75, 0, Math.PI)
        .bezierCurveTo(-s * 0.75, 0, -s * 0.35, -s * 0.4, 0, -s)
        .fill(GLYPH);
    case "B":
      // A crescent: a disc with a disc cut out of its upper right.
      return g
        .circle(0, 0, s * 0.85)
        .fill(GLYPH)
        .circle(s * 0.38, -s * 0.3, s * 0.68)
        .fill(MANA_COLORS.B);
    case "R":
      // A flame: a point at the top swelling to a round base.
      return g
        .moveTo(0, -s)
        .bezierCurveTo(s * 0.2, -s * 0.45, s * 0.8, -s * 0.15, s * 0.7, s * 0.35)
        .bezierCurveTo(s * 0.6, s * 0.9, -s * 0.6, s * 0.9, -s * 0.7, s * 0.35)
        .bezierCurveTo(-s * 0.75, 0, -s * 0.3, -s * 0.2, -s * 0.15, -s * 0.55)
        .bezierCurveTo(-s * 0.05, -s * 0.3, 0, -s * 0.6, 0, -s)
        .fill(GLYPH);
    case "G":
      // A tree: a triangle crown on a short trunk.
      return g
        .poly([0, -s, s * 0.75, s * 0.35, -s * 0.75, s * 0.35])
        .fill(GLYPH)
        .rect(-s * 0.15, s * 0.3, s * 0.3, s * 0.65)
        .fill(GLYPH);
  }
}
