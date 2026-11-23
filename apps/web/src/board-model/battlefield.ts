// The battlefield (arena-research.md, "The owner's phone screenshots"): each player's half has its creatures close to
// the band across the middle, centred, and an outer row further out with lands piled by name at the left and the other
// permanents at the right, planeswalkers at the right edge. The opponent's half mirrors the person's.

import type { PlayerId, SeatView, SeenCard } from "@mtg/engine";
import { COMPACT } from "../layout/compact.ts";
import { boardCard } from "./board-card.ts";
import type { BoardCard, PlayArea } from "./board-model.ts";
import { spread } from "./spread.ts";

export function battlefieldCards(shown: SeatView, area: PlayArea, me: PlayerId): BoardCard[] {
  const permanents = shown.view.zones.battlefield.flatMap((id) => {
    const seen = shown.seen[id];
    return seen?.kind === "card" ? [seen] : [];
  });
  // An attachment sits on its own (CR 301.5, 303.4): a land something is attached to isn't piled with the others.
  const hosts = new Set(permanents.flatMap((p) => (p.attachedTo === null ? [] : [p.attachedTo])));
  const sides = [false, true].map((mine) => {
    const own = permanents.filter((p) => (p.characteristics.controller === me) === mine);
    return halfCards(own, area, mine, hosts);
  });
  return sides.flat();
}

function halfCards(
  permanents: readonly SeenCard[],
  area: PlayArea,
  mine: boolean,
  hosts: ReadonlySet<string>,
): BoardCard[] {
  const { band, creatures, lands, others, rowGap, ratio } = COMPACT;
  const is = (p: SeenCard, type: string) => p.characteristics.types.some((t) => t === type);
  // A land that's also a creature (an animated land) fights as a creature, so it sits with them.
  const creatureRow = permanents.filter((p) => is(p, "creature"));
  const landRow = permanents.filter((p) => is(p, "land") && !is(p, "creature"));
  const otherRow = permanents.filter((p) => !is(p, "creature") && !is(p, "land"));
  const walkersLast = [
    ...otherRow.filter((p) => !is(p, "planeswalker")),
    ...otherRow.filter((p) => is(p, "planeswalker")),
  ];

  const bandY = area.y + band.y * area.h;
  const creatureH = creatures.h * area.h;
  const creatureY = mine ? bandY + (band.h / 2) * area.h : bandY - (band.h / 2) * area.h - creatureH;
  const outerH = lands.h * area.h;
  const outerY = mine ? creatureY + creatureH + rowGap * area.h : creatureY - rowGap * area.h - outerH;

  const look = (p: SeenCard) =>
    p.tapped ? { rotation: COMPACT.tapped.tilt, alpha: COMPACT.tapped.alpha } : { rotation: 0, alpha: 1 };
  const placed: BoardCard[] = [];

  // Lands, piled by name from the left edge.
  const piles = landPiles(landRow, hosts);
  const landW = outerH * ratio.battlefield;
  const step = lands.pileStep * area.w;
  const pileWidths = piles.map((pile) => landW + step * Math.min(pile.length - 1, 3));
  const pileXs = spread(
    pileWidths,
    area.x + lands.left * area.w,
    area.x + lands.right * area.w,
    lands.gap * area.w,
    "start",
  );
  piles.forEach((pile, i) => {
    // The back of the pile first, so the front card (with the count) is drawn last, on top.
    pile.forEach((land, j) => {
      const behind = Math.min(pile.length - 1 - j, 3);
      const rect = { x: (pileXs[i] ?? 0) + step * behind, y: outerY, width: landW, height: outerH };
      const count = j === pile.length - 1 && pile.length > 1 ? pile.length : null;
      placed.push(boardCard(land, "battlefield", mine, rect, { ...look(land), pileCount: count }));
    });
  });

  // Other permanents, from the right edge.
  const otherH = others.h * area.h;
  const otherW = otherH * ratio.battlefield;
  const otherXs = spread(
    walkersLast.map(() => otherW),
    area.x + others.left * area.w,
    // The person's row stops short of the main button and the phase ladder over it, at the bottom right.
    mine ? Math.min(area.x + others.right * area.w, mainButtonLeft(area)) : area.x + others.right * area.w,
    others.gap * area.w,
    "end",
  );
  walkersLast.forEach((p, i) => {
    const rect = { x: otherXs[i] ?? 0, y: outerY + (outerH - otherH), width: otherW, height: otherH };
    placed.push(boardCard(p, "battlefield", mine, rect, look(p)));
  });

  // Creatures, centred on the band.
  const creatureW = creatureH * ratio.battlefield;
  const creatureXs = spread(
    creatureRow.map(() => creatureW),
    area.x + creatures.margin * area.w,
    area.x + (1 - creatures.margin) * area.w,
    creatures.gap * area.w,
    "centre",
  );
  creatureRow.forEach((p, i) => {
    const rect = { x: creatureXs[i] ?? 0, y: creatureY, width: creatureW, height: creatureH };
    placed.push(boardCard(p, "battlefield", mine, rect, look(p)));
  });
  return placed;
}

function mainButtonLeft(area: PlayArea): number {
  const { mainButton } = COMPACT;
  return area.x + area.w - mainButton.right - mainButton.width - mainButton.clearance;
}

/**
 * Lands in piles [R]: the same name and the same state (tapped or not, no counters or damage, nothing attached to it
 * and attached to nothing) share a pile, since they're interchangeable to look at. Piles keep the order their first
 * land came in.
 */
function landPiles(lands: readonly SeenCard[], hosts: ReadonlySet<string>): SeenCard[][] {
  const piles = new Map<string, SeenCard[]>();
  for (const land of lands) {
    const plain =
      Object.keys(land.counters).length === 0 && land.damage === 0 && land.attachedTo === null && !hosts.has(land.id);
    const key = plain ? `${land.characteristics.name}|${land.tapped}` : land.id;
    piles.set(key, [...(piles.get(key) ?? []), land]);
  }
  // Untapped and tapped piles of a land side by side, by name, so a pile doesn't jump far when a land taps.
  return [...piles.values()].sort((a, b) => pileOrder(a).localeCompare(pileOrder(b)));
}

function pileOrder(pile: readonly SeenCard[]): string {
  const front = pile[0];
  return front === undefined ? "" : `${front.characteristics.name}|${front.tapped ? 1 : 0}`;
}
