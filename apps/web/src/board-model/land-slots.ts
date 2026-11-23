// Lands in the outer row [R], one slot per name: the untapped lands of that name in one pile, the tapped ones gathered
// in a second pile on top of it, from the right. Tapping a land moves it between the two piles of its slot, and a slot's
// width depends only on how many lands it holds, so nothing moves (ui.md: no layout shifts). A land that can't pile (a counter on it, something attached) has a slot
// of its own.

import type { SeenCard } from "@mtg/engine";
import { attachedRoom } from "./attachments.ts";
import type { Half } from "./battlefield.ts";
import type { BoardCard } from "./board-model.ts";
import { cardBasis } from "./card-basis.ts";
import { pileKey, pileOffsets, pileWidth, placePile } from "./piles.ts";
import { shrinkToFit, spread } from "./spread.ts";

type Slot = { untapped: SeenCard[]; tapped: SeenCard[] };

export function landSlots(
  lands: readonly SeenCard[],
  half: Half,
  row: { y: number; height: number; left: number; right: number },
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
  const gap = layout.lands.gap * area.width;
  // A slot's width depends only on how many lands it holds, never on how many are tapped: room for them all in one
  // pile plus the tapped pile's shift. The untapped pile sits at its left, the tapped one at its right.
  // A land something is attached to stands alone in its slot (it can't pile), the slot keeping room left of it for
  // its Aura (`attachments.ts`).
  const roomAt = (slot: Slot, cardW: number) => {
    const only = slot.untapped[0] ?? slot.tapped[0];
    return slot.untapped.length + slot.tapped.length === 1 && only !== undefined
      ? attachedRoom(half.attached, only.id, cardW, layout)
      : 0;
  };
  const slotWidthAt = (slot: Slot, cardH: number) => {
    const cardW = cardH * layout.ratio.battlefield;
    const count = slot.untapped.length + slot.tapped.length;
    const piles = count > 1 ? pileWidth(count, cardW, offsets.step) + layout.lands.tappedShift * cardW : cardW;
    return piles + roomAt(slot, cardW);
  };
  // A row too wide for its space shrinks its cards (down to `minH`) before it overlaps them, as the creature row does.
  const fits = (cardH: number) =>
    ordered.reduce((sum, slot) => sum + slotWidthAt(slot, cardH), 0) + gap * Math.max(0, ordered.length - 1) <=
    row.right - row.left;
  const h = shrinkToFit(row.height, layout.lands.minH * cardBasis(area, layout), fits);
  // The row's cards hug the creature row whatever their size.
  const y = mine ? row.y : row.y + row.height - h;
  const w = h * layout.ratio.battlefield;
  const room = (slot: Slot) => roomAt(slot, w);
  const slotWidth = (slot: Slot) => slotWidthAt(slot, h);
  const xs = spread(ordered.map(slotWidth), row.left, row.right, gap, "start");
  return ordered.flatMap((slot, i) => {
    const x = xs[i] ?? 0;
    const tappedX = x + slotWidth(slot) - pileWidth(slot.tapped.length, w, offsets.step);
    // The untapped pile behind; the tapped ones gathered on top of it, in front (the owner, ui.md "Tapped lands in a
    // pile"), so the pile never shows a tapped land half-hidden inside it.
    return [
      ...(slot.untapped.length > 0
        ? placePile(slot.untapped, { x: x + room(slot), y, width: w, height: h }, offsets, mine, "lands", look)
        : []),
      ...(slot.tapped.length > 0
        ? placePile(slot.tapped, { x: tappedX, y, width: w, height: h }, offsets, mine, "lands", look)
        : []),
    ];
  });
}
