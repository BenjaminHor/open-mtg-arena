// A permanent's badges, drawn (board-model/badges.ts says which): keyword icons in small dark circles along the top
// left [R], a summoning-sick mark first among them [R], counters in a small badge at the top right [R], and a
// planeswalker's loyalty in a shield [R]. Every icon is our own simple shape (D-140), light on dark, so it reads on any
// art; the card view says each in words.

import { Container, Graphics, Text } from "pixi.js";
import type { BadgeIcon, Badges } from "../board-model/badges.ts";
import { PALETTE } from "./palette.ts";

const INK = 0xf4f1ec;
const DISC = 0x161514;

/**
 * The icons along the top left, left to right: sickness, keywords, then the ellipsis; at most `room` discs, the last
 * an ellipsis when some don't fit. Its top left is at (0, 0).
 */
export function iconRow(badges: Badges, r: number, room: number): Container {
  const row = new Container();
  const all: (BadgeIcon | "sick" | "more")[] = [
    ...(badges.sick ? (["sick"] as const) : []),
    ...badges.icons,
    ...(badges.more ? (["more"] as const) : []),
  ];
  const fits = Math.max(0, room);
  const kinds =
    all.length <= fits
      ? all
      : fits === 0
        ? []
        : [...all.filter((k) => k !== "more").slice(0, fits - 1), "more" as const];
  kinds.forEach((kind, i) => {
    const badge = new Container();
    badge.addChild(
      new Graphics().circle(0, 0, r).fill({ color: DISC, alpha: 0.88 }).stroke({ width: 1, color: INK, alpha: 0.25 }),
    );
    badge.addChild(kind === "sick" ? sleepy(r) : icon(kind, r * 0.62));
    badge.position.set(r + i * (r * 2 + 2), r);
    row.addChild(badge);
  });
  return row;
}

/** Counters in short ("+2"), on a small dark badge; its right edge at x = 0, its top at y = 0. */
export function counterBadge(text: string, h: number): Container {
  const badge = new Container();
  const label = new Text({
    text,
    style: { fontFamily: PALETTE.sans, fontWeight: "600", fontSize: h * 0.72, fill: INK },
  });
  label.anchor.set(0.5);
  const w = Math.max(h, label.width + h * 0.5);
  badge.addChild(
    new Graphics()
      .roundRect(-w, 0, w, h, h * 0.3)
      .fill({ color: DISC, alpha: 0.9 })
      .stroke({ width: 1, color: INK, alpha: 0.3 }),
    label,
  );
  label.position.set(-w / 2, h / 2);
  return badge;
}

/** A planeswalker's loyalty: its number in a shield shape, `h` tall, its top left at (0, 0). */
export function loyaltyShield(loyalty: number, h: number): Container {
  const shield = new Container();
  const w = h * 1.05;
  shield.addChild(
    new Graphics()
      .moveTo(0, 0)
      .lineTo(w, 0)
      .lineTo(w, h * 0.55)
      .quadraticCurveTo(w, h * 0.85, w / 2, h)
      .quadraticCurveTo(0, h * 0.85, 0, h * 0.55)
      .closePath()
      .fill({ color: DISC, alpha: 0.9 })
      .stroke({ width: 1, color: INK, alpha: 0.45 }),
  );
  const label = new Text({
    text: `${loyalty}`,
    style: { fontFamily: PALETTE.sans, fontWeight: "700", fontSize: h * 0.58, fill: INK },
  });
  label.anchor.set(0.5);
  label.position.set(w / 2, h * 0.44);
  shield.addChild(label);
  return shield;
}

/** Two "z"s, small then larger, drawn as strokes like the other icons: asleep, it can't attack or tap yet. */
function sleepy(r: number): Graphics {
  const g = new Graphics();
  const z = (x: number, y: number, size: number) =>
    g
      .moveTo(x - size, y - size)
      .lineTo(x + size, y - size)
      .lineTo(x - size, y + size)
      .lineTo(x + size, y + size);
  z(-r * 0.32, r * 0.2, r * 0.22);
  z(r * 0.25, -r * 0.15, r * 0.32);
  return g.stroke({ width: Math.max(1.2, r * 0.16), color: INK, cap: "round", join: "round" });
}

/** Each keyword's icon in a box of half-size `s` about (0, 0). Shapes, not letters, so each reads at a glance. */
function icon(kind: BadgeIcon | "more", s: number): Graphics {
  const g = new Graphics();
  const line = { width: Math.max(1.2, s * 0.24), color: INK, cap: "round" as const, join: "round" as const };
  switch (kind) {
    case "flying":
      // A wing: a sweep and two feathers.
      return g
        .moveTo(-s, s * 0.6)
        .quadraticCurveTo(-s * 0.2, -s * 1.1, s, -s * 0.8)
        .quadraticCurveTo(s * 0.4, -s * 0.1, -s, s * 0.6)
        .fill(INK);
    case "reach":
      // An arrow up, reaching.
      return g
        .moveTo(0, s)
        .lineTo(0, -s)
        .moveTo(-s * 0.6, -s * 0.35)
        .lineTo(0, -s)
        .lineTo(s * 0.6, -s * 0.35)
        .stroke(line);
    case "first strike":
      return sword(g, s, 0, line);
    case "double strike":
      sword(g, s * 0.85, -s * 0.45, line);
      return sword(g, s * 0.85, s * 0.45, line);
    case "deathtouch":
      // A skull: a round head, a jaw, two eyes.
      g.circle(0, -s * 0.15, s * 0.8)
        .fill(INK)
        .rect(-s * 0.45, s * 0.35, s * 0.9, s * 0.55)
        .fill(INK);
      return g
        .circle(-s * 0.3, -s * 0.15, s * 0.22)
        .circle(s * 0.3, -s * 0.15, s * 0.22)
        .fill(DISC);
    case "trample":
      // Two chevrons pushing through.
      return g
        .moveTo(-s, -s * 0.7)
        .lineTo(-s * 0.2, 0)
        .lineTo(-s, s * 0.7)
        .moveTo(-s * 0.05, -s * 0.7)
        .lineTo(s * 0.75, 0)
        .lineTo(-s * 0.05, s * 0.7)
        .stroke(line);
    case "lifelink":
      // A heart.
      return g
        .moveTo(0, s)
        .bezierCurveTo(-s * 1.3, 0, -s * 0.7, -s * 1.1, 0, -s * 0.4)
        .bezierCurveTo(s * 0.7, -s * 1.1, s * 1.3, 0, 0, s)
        .fill(INK);
    case "vigilance":
      // An open eye.
      g.moveTo(-s, 0)
        .quadraticCurveTo(0, -s * 1.1, s, 0)
        .quadraticCurveTo(0, s * 1.1, -s, 0)
        .stroke(line);
      return g.circle(0, 0, s * 0.32).fill(INK);
    case "haste":
      // A lightning bolt.
      return g
        .poly([
          s * 0.2,
          -s,
          -s * 0.6,
          s * 0.15,
          -s * 0.05,
          s * 0.15,
          -s * 0.25,
          s,
          s * 0.6,
          -s * 0.2,
          s * 0.05,
          -s * 0.2,
        ])
        .fill(INK);
    case "indestructible":
      // A solid diamond.
      return g.poly([0, -s, s * 0.75, 0, 0, s, -s * 0.75, 0]).fill(INK);
    case "shroud":
      // A target, struck through: it can't be targeted.
      g.circle(0, 0, s * 0.8).stroke({ ...line, width: line.width * 0.8 });
      return g
        .moveTo(-s * 0.85, s * 0.85)
        .lineTo(s * 0.85, -s * 0.85)
        .stroke(line);
    case "forestwalk":
    case "swampwalk":
      // A footprint: a sole and three toes.
      g.ellipse(0, s * 0.3, s * 0.42, s * 0.65).fill(INK);
      return g
        .circle(-s * 0.4, -s * 0.6, s * 0.17)
        .circle(0, -s * 0.78, s * 0.19)
        .circle(s * 0.4, -s * 0.6, s * 0.17)
        .fill(INK);
    case "defender":
      // A wall of bricks.
      g.rect(-s, -s * 0.7, s * 2, s * 1.4).stroke({ ...line, width: line.width * 0.7 });
      return g
        .moveTo(-s, 0)
        .lineTo(s, 0)
        .moveTo(0, -s * 0.7)
        .lineTo(0, 0)
        .moveTo(-s * 0.5, 0)
        .lineTo(-s * 0.5, s * 0.7)
        .moveTo(s * 0.5, 0)
        .lineTo(s * 0.5, s * 0.7)
        .stroke({ ...line, width: line.width * 0.7 });
    case "protection":
      // A shield's outline (a blocker's badge is a filled one).
      return g
        .moveTo(0, -s)
        .lineTo(s * 0.85, -s * 0.6)
        .quadraticCurveTo(s * 0.8, s * 0.5, 0, s)
        .quadraticCurveTo(-s * 0.8, s * 0.5, -s * 0.85, -s * 0.6)
        .closePath()
        .stroke(line);
    case "more":
      return g
        .circle(-s * 0.65, 0, s * 0.2)
        .circle(0, 0, s * 0.2)
        .circle(s * 0.65, 0, s * 0.2)
        .fill(INK);
  }
}

function sword(g: Graphics, s: number, dx: number, line: { width: number; color: number }): Graphics {
  // A blade from the bottom left up to the top right, a crossguard near the hilt.
  return g
    .moveTo(dx - s * 0.7, s * 0.7)
    .lineTo(dx + s * 0.8, -s * 0.8)
    .moveTo(dx - s * 0.75, s * 0.15)
    .lineTo(dx - s * 0.15, s * 0.75)
    .stroke(line);
}
