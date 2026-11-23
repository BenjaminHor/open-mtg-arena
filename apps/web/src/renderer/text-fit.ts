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

/** `height`: the strip's height, for a wrapped name. */
export function fitText(
  text: Text,
  width: number,
  { height = Number.POSITIVE_INFINITY }: { height?: number } = {},
): void {
  const fits = () => text.width <= width;
  if (fits()) return;
  text.scale.x = Math.max(NARROWEST, width / (text.width / text.scale.x));
  let size = Number(text.style.fontSize);
  while (!fits() && size > SMALLEST) {
    size = Math.max(SMALLEST, size - 0.5);
    text.style.fontSize = size;
  }
  if (fits()) return;
  text.style.wordWrap = true;
  text.style.wordWrapWidth = width / text.scale.x;
  text.style.lineHeight = size * 1.02;
  while (text.height > height && size > SMALLEST_WRAPPED) {
    size = Math.max(SMALLEST_WRAPPED, size - 0.5);
    text.style.fontSize = size;
    text.style.lineHeight = size * 1.02;
  }
}
