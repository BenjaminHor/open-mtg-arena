// Which board layout a screen gets (ui.md, "Layouts"; M3-05, D-176).

import type { BoardLayout } from "./board-layout.ts";
import { COMPACT } from "./compact.ts";
import { FULL } from "./full.ts";

/**
 * Which layout a screen gets, by its size alone (ui.md: never by device): a short screen (a phone in landscape) gets
 * the compact layout, anything taller the full one. Picked again on every resize, so folding or unfolding re-lays out
 * the board with the game, the lifted card, the chosen targets and the open hand kept (they aren't the layout's).
 */
export function layoutFor(size: { width: number; height: number }): BoardLayout {
  return size.height < FULL_FROM_HEIGHT ? COMPACT : FULL;
}

/** px: the least height the full layout is for [guess: phones in landscape are 320-430 px tall, tablets 700+]. */
export const FULL_FROM_HEIGHT = 560;
