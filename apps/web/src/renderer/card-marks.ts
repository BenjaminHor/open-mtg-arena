// The marks drawn over a card: combat's badges, a pile's count, a tapped permanent's arrow. Each is a shape first and
// a colour second (ui.md, "Never color alone").

import { Container, Graphics, Text } from "pixi.js";
import { PALETTE } from "./palette.ts";

/**
 * An attacker's crossed swords or a blocker's shield, on a round badge at the card's top-right corner: two shapes, so
 * which side of combat a card is on never rests on the badge's colour.
 */
export function combatBadge(kind: "attack" | "block", w: number, h: number): Container {
  const badge = new Container();
  const r = combatBadgeRadius(h);
  const ring = kind === "attack" ? PALETTE.attack : PALETTE.block;
  badge.addChild(new Graphics().circle(0, 0, r).fill(PALETTE.rim).stroke({ width: 2, color: ring }));
  const s = r * 0.55;
  const icon = new Graphics();
  if (kind === "attack") {
    icon
      .moveTo(-s, -s)
      .lineTo(s, s)
      .moveTo(s, -s)
      .lineTo(-s, s)
      .moveTo(s * 0.35, s * 0.85)
      .lineTo(s * 0.85, s * 0.35)
      .moveTo(-s * 0.35, s * 0.85)
      .lineTo(-s * 0.85, s * 0.35)
      .stroke({ width: Math.max(1.5, r * 0.2), color: PALETTE.badgeText, cap: "round" });
  } else {
    icon
      .moveTo(0, -s)
      .lineTo(s * 0.9, -s * 0.6)
      .bezierCurveTo(s * 0.9, s * 0.3, s * 0.4, s * 0.8, 0, s * 1.05)
      .bezierCurveTo(-s * 0.4, s * 0.8, -s * 0.9, s * 0.3, -s * 0.9, -s * 0.6)
      .closePath()
      .fill(PALETTE.badgeText);
  }
  badge.addChild(icon);
  // At the top-right corner: clear of the power/toughness pills across the table, and the part of a huddled blocker
  // the next card never covers (a row is drawn right to left).
  badge.position.set(w / 2 - r * 0.7, -h / 2 + r * 0.7);
  return badge;
}

export function combatBadgeRadius(h: number): number {
  return Math.max(8, h * 0.13);
}

/** "x4" above a pile's front card, at its top left, as Arena counts a pile of tokens. */
export function pileBadge(count: number, w: number, h: number): Container {
  const badge = new Container();
  const text = new Text({
    text: `x${count}`,
    style: { fontFamily: PALETTE.sans, fontWeight: "700", fontSize: 11, fill: PALETTE.badgeText },
  });
  text.anchor.set(0.5);
  const bw = text.width + 8;
  const bh = text.height + 1;
  badge.addChild(
    new Graphics()
      .roundRect(-bw / 2, -bh / 2, bw, bh, 3)
      .fill(PALETTE.badge)
      .stroke({ width: 1, color: 0xffffff, alpha: 0.18 }),
    text,
  );
  // Above the card's top-left corner, clear of its name.
  badge.position.set(-w / 2 + bw / 2, -h / 2 - bh / 2 - 1);
  return badge;
}

/** A large curved arrow over a tapped permanent [R], light with a dark edge: tapped shows by shape, not by shade. */
export function tapMark(size: number): Graphics {
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
