// Lands in the outer row [R], one slot per name: the untapped lands of that name in one pile, the tapped ones in a
// second pile overlapping it from the right. Tapping a land moves it between the two piles of its slot, and a slot's
// width depends only on how many lands it holds, so nothing moves (ui.md: no layout shifts). A land that can't pile (a counter on it, something attached) has a slot
// of its own.

import type { SeenCard } from "@mtg/engine";
import type { Half } from "./battlefield.ts";
import type { BoardCard } from "./board-model.ts";
import { pileKey, pileOffsets, pileWidth, placePile } from "./piles.ts";
import { spread } from "./spread.ts";

type Slot = { untapped: SeenCard[]; tapped: SeenCard[] };

export function landSlots(
  lands: readonly SeenCard[],
  half: Half,
  row: { y: number; height: number; right: number },
  look: (card: SeenCard) => { rotation: number; dim: number },
): BoardCard[] {
  const { area, layout, mine } = half;
  const slots = new Map<string, Slot>();
  for (const land of lands) {
    const key = pileKey(land, half.hosts) === null ? land.id : land.characteristics.name;
    const slot = slots.get(key) ?? { untapped: [], tapped: [] };
    (land.tapped ? slot.tapped : slot.untapped).push(land);
    slots.set(key, slot);
  }
  // By name: a plain comparison, so the order doesn't depend on the browser's locale.
  const ordered = [...slots.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, slot]) => slot);
  const offsets = pileOffsets(area, layout);
  const w = row.height * layout.ratio.battlefield;
  const shift = layout.lands.tappedShift * w;
  // A slot's width depends only on how many lands it holds, never on how many are tapped: room for them all in one
  // pile plus the tapped pile's shift. The untapped pile sits at its left, the tapped one at its right.
  const slotWidth = (slot: Slot) => {
    const count = slot.untapped.length + slot.tapped.length;
    return count > 1 ? pileWidth(count, w, offsets.step) + shift : w;
  };
  const xs = spread(
    ordered.map(slotWidth),
    area.x + layout.lands.left * area.width,
    row.right,
    layout.lands.gap * area.width,
    "start",
  );
  return ordered.flatMap((slot, i) => {
    const x = xs[i] ?? 0;
    const tappedX = x + slotWidth(slot) - pileWidth(slot.tapped.length, w, offsets.step);
    // The tapped pile behind; the untapped one, what's still available, in front.
    return [
      ...(slot.tapped.length > 0
        ? placePile(slot.tapped, { x: tappedX, y: row.y, width: w, height: row.height }, offsets, mine, look)
        : []),
      ...(slot.untapped.length > 0
        ? placePile(slot.untapped, { x, y: row.y, width: w, height: row.height }, offsets, mine, look)
        : []),
    ];
  });
}
