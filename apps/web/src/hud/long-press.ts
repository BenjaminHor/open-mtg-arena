// "Look at this" on something that isn't a card (M3-04c slice 5): a long-press on touch, a right-click with a mouse, or
// "i" with the keyboard, as the card view opens on a card (`card-inspect.ts`). A player's info block uses it to open
// their zones even while a tap on it picks them as a target.

import { useEffect, useRef } from "react";
import { isTouch } from "./CardView.tsx";
import { swallowNextClick } from "./swallow-click.ts";

/** ms and px, as a card's long-press (`card-inspect.ts`). */
const LONG_PRESS = 400;
const SLOP = 8;

export type LookHandlers = {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
};

export function useLook(look: () => void): LookHandlers {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const at = useRef<{ x: number; y: number } | null>(null);
  const latest = useRef(look);
  latest.current = look;
  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  // No timer outlives the block.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  return {
    onPointerDown: (e) => {
      clear();
      if (e.pointerType === "mouse" || !e.isPrimary) return;
      at.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        // The release's click isn't also a tap (which would pick the player as a target).
        swallowNextClick();
        latest.current();
      }, LONG_PRESS);
    },
    onPointerMove: (e) => {
      const from = at.current;
      if (from !== null && Math.hypot(e.clientX - from.x, e.clientY - from.y) > SLOP) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onContextMenu: (e) => {
      e.preventDefault();
      // A long hold fires one on Android too: the timer above handles touch.
      if (!isTouch(e)) latest.current();
    },
    onKeyDown: (e) => {
      if (e.key === "i" && !e.repeat) latest.current();
    },
  };
}
