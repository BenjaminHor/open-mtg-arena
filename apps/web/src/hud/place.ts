// A board-model rectangle as absolute CSS placement: the HUD puts everything where the model says.

import type { Rect } from "../board-model/board-model.ts";

export function place(rect: Rect): React.CSSProperties {
  return { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
}
