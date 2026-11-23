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
/** ms: a mouse moving from one card to the next within this long swaps the preview at once, as Arena's does. */
const SWAP = 150;

export type InspectOpen = (id: ObjectId, mode: "full" | "preview") => void;

/** What the card view needs from the app: open it, close a preview, and start loading a card's image early. */
export type InspectCallbacks = { open: InspectOpen; closePreview: () => void; prefetch: (id: ObjectId) => void };

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

export function useCardInspect(on: InspectCallbacks): (id: ObjectId) => InspectHandlers {
  // One timer at a time: a press's or a hover's. `at` is where the pointer is, for a press's slop and a hover's check.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const at = useRef<{ x: number; y: number } | null>(null);
  // A long-press that opened the view waits for its release on the window, not on the card: the card's region may be
  // redrawn or gone by then (the game moves on while the finger is down), and its click must still be swallowed.
  const waiting = useRef<(() => void) | null>(null);
  const latest = useRef(on);
  latest.current = on;
  // A preview is showing (this hook opened it), and until when a move to another card swaps it straight away.
  const previewing = useRef(false);
  const swapUntil = useRef(0);
  // The region being held: marked at once, a ring filling over the hold (ui.md: feedback within 100 ms). A class set
  // on the element directly, not through React, so a press never redraws the board.
  const held = useRef<Element | null>(null);
  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    held.current?.classList.remove("held");
    held.current = null;
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
      held.current = e.currentTarget;
      held.current.classList.add("held");
      // The image the view will show starts loading now: the 400 ms hold is its head start.
      latest.current.prefetch(id);
      const pointer = e.pointerId;
      timer.current = setTimeout(() => {
        clear();
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
      latest.current.prefetch(id);
      const show = () => {
        timer.current = null;
        // Only if the mouse is still on this card: its region may have gone meanwhile, with no "leave" to say so.
        const where = at.current;
        if (where === null || cardAt(where.x, where.y) !== id) return;
        previewing.current = true;
        latest.current.open(id, "preview");
      };
      // Sweeping across cards: once a preview shows, the next card's replaces it with no wait.
      if (performance.now() < swapUntil.current) show();
      else timer.current = setTimeout(show, HOVER);
    },
    onPointerLeave: (e) => {
      if (e.pointerType !== "mouse") return;
      clear();
      if (previewing.current) swapUntil.current = performance.now() + SWAP;
      previewing.current = false;
      latest.current.closePreview();
    },
    onContextMenu: (e) => {
      e.preventDefault();
      clear();
      latest.current.open(id, "full");
    },
  });
}
