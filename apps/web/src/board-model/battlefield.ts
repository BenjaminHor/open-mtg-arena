// The battlefield (arena-research.md, "The owner's phone screenshots"): each player's half has its creatures close to
// the band across the middle, centred, and an outer row further out with lands at the left and the other permanents at
// the right, planeswalkers at the right edge. The opponent's half mirrors the person's. The outer rows stop short of
// the life crests on the centre line, and the person's short of the main button.

import type { PlayerId, SeatView, SeenCard } from "@mtg/engine";
import type { BoardLayout } from "../layout/board-layout.ts";
import { boardCard } from "./board-card.ts";
import type { BoardCard, OverlayAnchors, Rect } from "./board-model.ts";
import { landSlots } from "./land-slots.ts";
import { pileOffsets, pilesOf, pileWidth, placePile } from "./piles.ts";
import { spread } from "./spread.ts";

export function battlefieldCards(
  shown: SeatView,
  area: Rect,
  me: PlayerId,
  layout: BoardLayout,
  overlay: OverlayAnchors,
): BoardCard[] {
  const permanents = shown.view.zones.battlefield.flatMap((id) => {
    const seen = shown.seen[id];
    return seen?.kind === "card" ? [seen] : [];
  });
  // An attachment sits on its own (CR 301.5, 303.4): a permanent something is attached to isn't piled with others.
  const hosts = new Set(permanents.flatMap((p) => (p.attachedTo === null ? [] : [p.attachedTo])));
  return [false, true].flatMap((mine) => {
    const own = permanents.filter((p) => (p.characteristics.controller === me) === mine);
    return halfCards(own, { area, mine, hosts, layout, overlay });
  });
}

export type Half = {
  area: Rect;
  mine: boolean;
  hosts: ReadonlySet<string>;
  layout: BoardLayout;
  overlay: OverlayAnchors;
};

function halfCards(permanents: readonly SeenCard[], half: Half): BoardCard[] {
  const { area, mine, layout, overlay } = half;
  const { band, creatures, lands, others, rowGap, ratio, tapped } = layout;
  const is = (p: SeenCard, type: string) => p.characteristics.types.some((t) => t === type);
  // A land that's also a creature (an animated land) fights as a creature, so it sits with them.
  const creatureRow = permanents.filter((p) => is(p, "creature"));
  const landRow = permanents.filter((p) => is(p, "land") && !is(p, "creature"));
  const otherRow = permanents.filter((p) => !is(p, "creature") && !is(p, "land"));
  const walkersLast = [
    ...otherRow.filter((p) => !is(p, "planeswalker")),
    ...otherRow.filter((p) => is(p, "planeswalker")),
  ];

  // Rows are placed by the creature row's full height, so a row that shrinks doesn't move the others.
  const bandY = area.y + band.y * area.height;
  const fullH = creatures.h * area.height;
  const creatureTop = mine ? bandY + (band.h / 2) * area.height : bandY - (band.h / 2) * area.height - fullH;
  const outerH = lands.h * area.height;
  const outerY = mine ? creatureTop + fullH + rowGap * area.height : creatureTop - rowGap * area.height - outerH;
  const crest = mine ? overlay.life.mine : overlay.life.opponent;
  // An attacker tilts as it taps but isn't shaded: it's the card everyone is looking at.
  const look = (p: SeenCard) =>
    p.tapped ? { rotation: tapped.tilt, dim: p.attacking === null ? tapped.dim : 0 } : { rotation: 0, dim: 0 };
  const offsets = pileOffsets(area, layout);

  // Lands, a slot per name from the left edge, up to the life crest.
  const landRight = Math.min(area.x + lands.right * area.width, crest.x - layout.crestClearance);
  const placed = landSlots(landRow, half, { y: outerY, height: outerH, right: landRight }, look);

  // Other permanents, from the right edge back towards the crest.
  const otherH = others.h * area.height;
  const otherW = otherH * ratio.battlefield;
  // The person's row stops short of the main button and the phase ladder over it, at the bottom right.
  const buttonLeft = overlay.mainButton.x - layout.mainButton.clearance;
  const otherXs = spread(
    walkersLast.map(() => otherW),
    Math.max(area.x + others.left * area.width, crest.x + crest.width + layout.crestClearance),
    mine ? Math.min(area.x + others.right * area.width, buttonLeft) : area.x + others.right * area.width,
    others.gap * area.width,
    "end",
  );
  walkersLast.forEach((p, i) => {
    const rect = { x: otherXs[i] ?? 0, y: outerY + (outerH - otherH), width: otherW, height: otherH };
    placed.push(boardCard(p, "battlefield", mine, rect, { ...look(p), row: "others" }));
  });

  // Creatures, identical ones piled, centred on the band: a row too wide shrinks its cards before it overlaps them.
  const piles = pilesOf(creatureRow, half.hosts);
  const left = area.x + creatures.margin * area.width;
  const right = area.x + (1 - creatures.margin) * area.width;
  const gap = creatures.gap * area.width;
  const widthAt = (h: number) =>
    piles.reduce((sum, pile) => sum + pileWidth(pile.length, h * ratio.battlefield, offsets.step), 0) +
    gap * Math.max(0, piles.length - 1);
  let h = fullH;
  const smallest = creatures.minH * area.height;
  while (h > smallest && widthAt(h) > right - left) h = Math.max(smallest, h - 1);
  const w = h * ratio.battlefield;
  const xs = spread(
    piles.map((pile) => pileWidth(pile.length, w, offsets.step)),
    left,
    right,
    gap,
    "centre",
  );
  // The row's cards hug the band whatever their size.
  const y = mine ? creatureTop : creatureTop + fullH - h;
  const rows = piles.map((pile, i) =>
    placePile(pile, { x: xs[i] ?? 0, y, width: w, height: h }, offsets, mine, "creatures", look),
  );
  // Drawn right to left: when the row overlaps, each card covers only the left edge of the one after it, which keeps
  // the power/toughness pill at its bottom centre in sight, and the leftmost card, drawn last, is whole.
  for (const pile of rows.reverse()) placed.push(...pile);
  return placed;
}
