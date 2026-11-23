// Combat on the board (ui.md, "Attacks and blocks"): attacking creatures (CR 508.1) step toward the band, each blocker
// (CR 509.1) moves along its row to sit opposite the attacker it blocks, and links join what position can't pair. The rows themselves
// were laid out first (battlefield.ts); this only moves cards within them, so outside combat it changes nothing.

import type { BoardLayout } from "../layout/board-layout.ts";
import type { BoardCard, CombatLink, Rect } from "./board-model.ts";
import { spread } from "./spread.ts";

export function withCombat(
  cards: readonly BoardCard[],
  area: Rect,
  layout: BoardLayout,
): { cards: BoardCard[]; links: CombatLink[] } {
  const advance = layout.combat.advance * area.height;
  // Attackers step toward the band: the person's up, the opponent's down.
  const stepped = cards.map((c) => (c.attacking ? { ...c, y: c.y + (c.mine ? -advance : advance) } : c));
  const byId = new Map(stepped.map((c) => [c.id, c]));
  const moved = [true, false].flatMap((mine) =>
    stepped.some((c) => c.mine === mine && c.blocking.length > 0)
      ? alignBlockers(stepped, byId, mine, area, layout)
      : [],
  );
  const placed = stepped.map((c) => moved.find((m) => m.id === c.id) ?? c);
  const at = new Map(placed.map((c) => [c.id, c]));
  const links: CombatLink[] = [];
  for (const card of placed) {
    // A lone declared blocker under its attacker needs no line: where it sits, and its shield, say whom it blocks. A
    // beam joins the rest to their attackers, edge to edge across the open table (never over a power/toughness pill): a blocker picked in the declaration
    // under way (as Arena draws its beam while blockers are chosen [R]), one of a gang (a huddle can sit over a
    // neighbouring attacker), and one the row pushed out from under its attacker.
    for (const attacker of card.blocking.flatMap((id) => at.get(id) ?? [])) {
      const under = card.x < attacker.x + attacker.width && attacker.x < card.x + card.width;
      const gang = placed.filter((c) => c.blocking.includes(attacker.id)).length > 1;
      if (card.picked || gang || !under) links.push({ kind: "block", from: facing(card), to: facing(attacker) });
    }
    const walker = card.attacks === null ? undefined : at.get(card.attacks);
    if (walker !== undefined) links.push({ kind: "attack", from: facing(card), to: centre(walker) });
  }
  return { cards: drawOrder(placed), links };
}

/**
 * The cards back to front again once combat has moved some: each creature row drawn right to left by pile (as
 * battlefield.ts draws it, so an overlap never hides a power/toughness pill), the rest as they were.
 */
function drawOrder(cards: readonly BoardCard[]): BoardCard[] {
  const rest = cards.filter((c) => c.row !== "creatures");
  const rows = [false, true].flatMap((mine) => {
    const row = cards.filter((c) => c.row === "creatures" && c.mine === mine);
    const piles = [...new Set(row.map((c) => c.pileOf))].map((pileOf) => row.filter((c) => c.pileOf === pileOf));
    const left = (pile: readonly BoardCard[]) => Math.min(...pile.map((c) => c.x));
    return piles.sort((a, b) => left(b) - left(a)).flat();
  });
  return [...rest, ...rows];
}

/**
 * One side's creature row with its blockers under their attackers. The blockers of one attacker huddle as a group,
 * overlapped and centred under it (as Arena gathers a gang block), so no blocker sits under an attacker it doesn't
 * block. The groups go first, under their attackers; then every other pile takes the free space nearest where it was,
 * so a creature that isn't blocking steps aside for one that is.
 */
function alignBlockers(
  cards: readonly BoardCard[],
  byId: ReadonlyMap<string, BoardCard>,
  mine: boolean,
  area: Rect,
  layout: BoardLayout,
): BoardCard[] {
  const row = cards.filter((c) => c.mine === mine && c.row === "creatures");
  const gap = layout.creatures.gap * area.width;
  const huddle = layout.combat.gangOverlap;
  type Unit = { members: BoardCard[]; offsets: number[]; width: number; wish: number; blocks: boolean; at: number };
  const units: Unit[] = [];
  const gangs = new Map<string, BoardCard[]>();
  for (const pileOf of new Set(row.map((c) => c.pileOf))) {
    const members = row.filter((c) => c.pileOf === pileOf);
    const attacker = members.find((c) => c.blocking.length > 0)?.blocking[0];
    if (attacker !== undefined && byId.has(attacker)) {
      gangs.set(attacker, [...(gangs.get(attacker) ?? []), ...members]);
      continue;
    }
    // A host's room for what's attached beside it (`attachments.ts`) moves with it, so nothing lands on it.
    const left = Math.min(...members.map((c) => c.x - roomOf(c, layout)));
    const width = Math.max(...members.map((c) => c.x + c.width)) - left;
    units.push({ members, offsets: members.map((c) => c.x - left), width, wish: left, blocks: false, at: left });
  }
  for (const [attackerId, gang] of gangs) {
    const attacker = byId.get(attackerId) as BoardCard;
    // Left to right as they stood, so no two blockers cross on the way to the huddle.
    const members = [...gang].sort((a, b) => a.x - b.x);
    const w = members[0]?.width ?? 0;
    const step = w * (1 - huddle);
    const cards = w + step * (members.length - 1);
    // The leftmost blocker's room for its attachments; an inner one's peek is under the huddle anyway.
    const room = members[0] === undefined ? 0 : roomOf(members[0], layout);
    const wish = attacker.x + attacker.width / 2 - cards / 2 - room;
    units.push({
      members,
      offsets: members.map((_, k) => room + k * step),
      width: cards + room,
      wish,
      blocks: true,
      at: wish,
    });
  }
  const lo = area.x + layout.creatures.margin * area.width;
  const hi = area.x + (1 - layout.creatures.margin) * area.width;
  const room = hi - lo;
  const total = units.reduce((sum, u) => sum + u.width, 0) + gap * Math.max(0, units.length - 1);
  if (total > room) {
    // A row too full to give every blocker its attacker's place: keep them in the order of their wishes, spread evenly
    // across the row (overlapping, as a full row does), so nothing piles on top of anything else.
    const ordered = [...units].sort((a, b) => a.wish - b.wish);
    const xs = spread(
      ordered.map((u) => u.width),
      lo,
      hi,
      gap,
      "centre",
    );
    ordered.forEach((u, i) => {
      u.at = xs[i] ?? u.at;
    });
  } else {
    // Blocker groups first, at their attackers, swept apart if two would overlap.
    const groups = units.filter((u) => u.blocks).sort((a, b) => a.wish - b.wish);
    let next = Number.NEGATIVE_INFINITY;
    for (const g of groups) {
      g.at = Math.min(Math.max(g.wish, next, lo), hi - g.width);
      next = g.at + g.width + gap;
    }
    // Then every other pile, into the free space nearest where it was.
    const taken = groups.map((g) => ({ from: g.at - gap, to: g.at + g.width + gap }));
    for (const u of units.filter((u) => !u.blocks).sort((a, b) => a.wish - b.wish)) {
      u.at = nearestFree(u.wish, u.width, lo, hi, taken);
      taken.push({ from: u.at - gap, to: u.at + u.width + gap });
    }
  }
  return units.flatMap((u) => u.members.map((c, k) => ({ ...c, x: u.at + (u.offsets[k] ?? 0) })));
}

/**
 * The left edge nearest `wish` where something `width` wide fits between `lo` and `hi` without touching what's taken;
 * `wish` itself when there's no such place (the row is full: it overlaps rather than leave the screen).
 */
function nearestFree(
  wish: number,
  width: number,
  lo: number,
  hi: number,
  taken: readonly { from: number; to: number }[],
): number {
  const sorted = [...taken].sort((a, b) => a.from - b.from);
  const gaps: { from: number; to: number }[] = [];
  let cursor = lo;
  for (const t of sorted) {
    if (t.from > cursor) gaps.push({ from: cursor, to: t.from });
    cursor = Math.max(cursor, t.to);
  }
  if (cursor < hi) gaps.push({ from: cursor, to: hi });
  let best: number | null = null;
  for (const g of gaps.filter((g) => g.to - g.from >= width)) {
    const x = Math.min(Math.max(wish, g.from), g.to - width);
    if (best === null || Math.abs(x - wish) < Math.abs(best - wish)) best = x;
  }
  return best ?? Math.min(Math.max(wish, lo), hi - width);
}

/** The middle of the card's edge that faces the band. */
function facing(c: BoardCard): { x: number; y: number } {
  return { x: c.x + c.width / 2, y: c.mine ? c.y : c.y + c.height };
}

function centre(c: BoardCard): { x: number; y: number } {
  return { x: c.x + c.width / 2, y: c.y + c.height / 2 };
}

/** The room left of a card for the Auras and Equipment beside it (`attachments.ts`). */
function roomOf(c: BoardCard, layout: BoardLayout): number {
  return c.attachments * layout.attach.peek * c.width;
}
