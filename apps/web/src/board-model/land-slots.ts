// Lands in the outer row [R], one slot per name: the untapped lands of that name in one pile, the tapped ones gathered
// in a second pile on top of it, from the right. Tapping a land moves it between the two piles of its slot, and a slot's
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
    // The slot is the pile key with the tapped state left out: tapped and untapped twins share it.
    const key = pileKey({ ...land, tapped: false }, half.apart) ?? land.id;
    const slot = slots.get(key) ?? { untapped: [], tapped: [] };
    (land.tapped ? slot.tapped : slot.untapped).push(land);
    slots.set(key, slot);
  }
  // By name, then by object id for slots of the same name, in numeric order: a plain comparison, so the order doesn't
  // depend on the browser's locale, and a land that stands apart sits beside its same-name slot.
  const order = (slot: Slot) => {
    const first = slot.untapped[0] ?? slot.tapped[0];
    return { name: first?.characteristics.name ?? "", id: Number((first?.id ?? "o0").slice(1)) };
  };
  const ordered = [...slots.values()].sort((a, b) => {
    const [x, y] = [order(a), order(b)];
    return x.name < y.name ? -1 : x.name > y.name ? 1 : x.id - y.id;
  });
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
    // The untapped pile behind; the tapped ones gathered on top of it, in front (the owner, ui.md "Tapped lands in a
    // pile"), so the pile never shows a tapped land half-hidden inside it.
    return [
      ...(slot.untapped.length > 0
        ? placePile(slot.untapped, { x, y: row.y, width: w, height: row.height }, offsets, mine, "lands", look)
        : []),
      ...(slot.tapped.length > 0
        ? placePile(slot.tapped, { x: tappedX, y: row.y, width: w, height: row.height }, offsets, mine, "lands", look)
        : []),
    ];
  });
}
