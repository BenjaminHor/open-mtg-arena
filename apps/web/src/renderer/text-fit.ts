// Fitting a name to its strip: Arena never cuts a card's name off (ui.md, "Names are never cut off"). The text is
// squeezed sideways first (as Arena's long names are), then made smaller down to a size still readable on a phone,
// then wrapped onto two lines (smaller again only if two lines don't fit the strip's height). Never an ellipsis.

import type { Text } from "pixi.js";

/** How narrow text may be squeezed: 72% of its width still reads as the same letters. */
const NARROWEST = 0.72;
/** The smallest size, in CSS px, a name shrinks to on one line before it wraps. */
const SMALLEST = 6;
/** The smallest size a wrapped name may take to fit the strip's height. */
const SMALLEST_WRAPPED = 4.5;

/**
 * `height`: the strip's height, for a wrapped name. `oneLine`: never wrap or squeeze (a permanent's name shares its line
 * with the power/toughness): shrink instead, down to the wrapped size's floor.
 */
export function fitText(
  text: Text,
  width: number,
  { height = Number.POSITIVE_INFINITY, oneLine = false }: { height?: number; oneLine?: boolean } = {},
): void {
  const fits = () => text.width <= width;
  if (fits()) return;
  // A permanent's name keeps its letters' natural width (the owner, ui.md "The font"): it only gets smaller.
  if (!oneLine) text.scale.x = Math.max(NARROWEST, width / (text.width / text.scale.x));
  let size = Number(text.style.fontSize);
  const floor = oneLine ? SMALLEST_WRAPPED : SMALLEST;
  while (!fits() && size > floor) {
    size = Math.max(floor, size - 0.5);
    text.style.fontSize = size;
  }
  if (fits() || oneLine) return;
  text.style.wordWrap = true;
  text.style.wordWrapWidth = width / text.scale.x;
  text.style.lineHeight = size * 1.02;
  while (text.height > height && size > SMALLEST_WRAPPED) {
    size = Math.max(SMALLEST_WRAPPED, size - 0.5);
    text.style.fontSize = size;
    text.style.lineHeight = size * 1.02;
  }
}
