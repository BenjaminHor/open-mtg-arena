// How the card view opens (M3-04c; arena-research.md, "The Examined view"): a long-press on touch, a right-click with
// a mouse, or a mouse resting on a card for a moment (a preview that goes when it leaves), as Arena does (D-160). Each
// card's region gets these handlers, and its card id as `data-card` (the "i" key and the preview's end both read it).

import type { ObjectId } from "@mtg/engine";
import { useEffect, useRef } from "react";
import { swallowNextClick } from "./swallow-click.ts";

/** ms: a press held this long without moving is a long-press (ui.md: about 400 ms); a mouse resting this long, a hover. */
const LONG_PRESS = 400;
const HOVER = 600;
/** px: a press that moves more than this is a drag or a scroll, not a long-press. */
const SLOP = 8;

export type InspectOpen = (id: ObjectId, mode: "full" | "preview") => void;

export type InspectHandlers = {
  "data-card": ObjectId;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerEnter: (e: React.PointerEvent) => void;
  onPointerLeave: (e: React.PointerEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
};

/** The card whose region is at a point on the screen, by its `data-card`, or null. */
export function cardAt(x: number, y: number): string | null {
  return document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-card]")?.dataset.card ?? null;
}

export function useCardInspect(open: InspectOpen, closePreview: () => void): (id: ObjectId) => InspectHandlers {
  // One timer at a time: a press's or a hover's. `at` is where the pointer is, for a press's slop and a hover's check.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const at = useRef<{ x: number; y: number } | null>(null);
  // A long-press that opened the view waits for its release on the window, not on the card: the card's region may be
  // redrawn or gone by then (the game moves on while the finger is down), and its click must still be swallowed.
  const waiting = useRef<(() => void) | null>(null);
  const latest = useRef({ open, closePreview });
  latest.current = { open, closePreview };
  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  // Nothing outlives the board: no timer to open a view later, no listener for a release.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      waiting.current?.();
    },
    [],
  );
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
  return (id) => ({
    "data-card": id,
    onPointerDown: (e) => {
      clear();
      // A click is not a hover: no preview pops up a moment after it.
      if (e.pointerType === "mouse" || !e.isPrimary) return;
      at.current = { x: e.clientX, y: e.clientY };
      const pointer = e.pointerId;
      timer.current = setTimeout(() => {
        timer.current = null;
        swallowRelease(pointer);
        latest.current.open(id, "full");
      }, LONG_PRESS);
    },
    onPointerMove: (e) => {
      const from = at.current;
      if (e.pointerType === "mouse") at.current = { x: e.clientX, y: e.clientY };
      else if (from !== null && Math.hypot(e.clientX - from.x, e.clientY - from.y) > SLOP) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerEnter: (e) => {
      if (e.pointerType !== "mouse" || e.buttons !== 0) return;
      clear();
      at.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        // Only if the mouse is still on this card: its region may have gone meanwhile, with no "leave" to say so.
        const where = at.current;
        if (where !== null && cardAt(where.x, where.y) === id) latest.current.open(id, "preview");
      }, HOVER);
    },
    onPointerLeave: (e) => {
      if (e.pointerType !== "mouse") return;
      clear();
      latest.current.closePreview();
    },
    onContextMenu: (e) => {
      e.preventDefault();
      clear();
      latest.current.open(id, "full");
    },
  });
}
