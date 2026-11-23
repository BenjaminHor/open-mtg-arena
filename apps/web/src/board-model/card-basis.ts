// What cards' heights are shares of (`BoardLayout.cardBasis`, D-176): the play area's height, or a share of its width
// when that's less, so a screen tall for its width doesn't get cards too wide for their rows.

import type { BoardLayout } from "../layout/board-layout.ts";
import type { Rect } from "./board-model.ts";

export function cardBasis(area: Rect, layout: BoardLayout): number {
  return Math.min(area.height, layout.cardBasis * area.width);
}
