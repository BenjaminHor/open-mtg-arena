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
  // The element being held: marked at once, a ring filling over the hold (ui.md: feedback within 100 ms), as a card's.
  const held = useRef<Element | null>(null);
  // A fired long-press waiting for its release, on the window: by then the browser covers the block.
  const waiting = useRef<(() => void) | null>(null);
  const latest = useRef(look);
  latest.current = look;
  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    held.current?.classList.remove("held");
    held.current = null;
  };
  // No timer or listener outlives the block.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      waiting.current?.();
    },
    [],
  );
  // The release's click isn't also a tap (which would pick the player, or close the browser just opened): swallowed
  // when the finger lifts, however long it was held after the press fired.
  const swallowRelease = (pointer: number) => {
    waiting.current?.();
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      stop();
      if (e.type === "pointerup") swallowNextClick();
    };
    const stop = () => {
      window.removeEventListener("pointerup", end, { capture: true });
      window.removeEventListener("pointercancel", end, { capture: true });
      waiting.current = null;
    };
    window.addEventListener("pointerup", end, { capture: true });
    window.addEventListener("pointercancel", end, { capture: true });
    waiting.current = stop;
  };
  return {
    onPointerDown: (e) => {
      clear();
      if (e.pointerType === "mouse" || !e.isPrimary) return;
      at.current = { x: e.clientX, y: e.clientY };
      held.current = e.currentTarget;
      held.current.classList.add("held");
      const pointer = e.pointerId;
      timer.current = setTimeout(() => {
        clear();
        swallowRelease(pointer);
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
