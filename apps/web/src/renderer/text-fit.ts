// Fitting a line of text to a width: Arena never cuts a card's name off (ui.md, "Names are never cut off"), so the
// text shrinks first, down to a size still readable on a phone, and only past that ends in an ellipsis.

import type { Text } from "pixi.js";

/** The smallest size, in CSS px, a name shrinks to before it's shortened. */
const SMALLEST = 4.5;

export function fitText(text: Text, full: string, width: number): void {
  let size = Number(text.style.fontSize);
  while (text.width > width && size > SMALLEST) {
    size = Math.max(SMALLEST, size - 0.5);
    text.style.fontSize = size;
  }
  let shown = full;
  while (shown.length > 1 && text.width > width) {
    shown = shown.slice(0, -1);
    text.text = `${shown.trimEnd()}…`;
  }
}
