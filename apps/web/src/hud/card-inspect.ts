// How the card view opens (M3-04c; arena-research.md, "The Examined view"): a long-press on touch, a right-click with
// a mouse, or a mouse resting on a card for a moment (a preview that goes when it leaves), as Arena does (D-160). Each
// card's region gets these handlers; a long-press that opened the view swallows the click its release fires, so it's
// never also a tap.

import type { ObjectId } from "@mtg/engine";
import { useEffect, useRef } from "react";
import { swallowNextClick } from "./hand-drag.ts";

/** ms: a press held this long without moving is a long-press (ui.md: about 400 ms); a mouse resting this long, a hover. */
const LONG_PRESS = 400;
const HOVER = 600;
/** px: a press that moves more than this is a drag or a scroll, not a long-press. */
const SLOP = 8;

export type InspectOpen = (id: ObjectId, mode: "full" | "preview") => void;

export type InspectHandlers = {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerEnter: (e: React.PointerEvent) => void;
  onPointerLeave: (e: React.PointerEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
};

export function useCardInspect(open: InspectOpen, closePreview: () => void): (id: ObjectId) => InspectHandlers {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  // A long-press opened the view: the click its release fires (however long after) is swallowed, so it neither taps
  // the card nor closes the view straight away.
  const opened = useRef(false);
  const latest = useRef({ open, closePreview });
  latest.current = { open, closePreview };
  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  // No timer outlives the board: an unmount mid-press leaves nothing to open later.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  return (id) => ({
    onPointerDown: (e) => {
      if (e.pointerType === "mouse" || !e.isPrimary) return;
      clear();
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        clear();
        opened.current = true;
        latest.current.open(id, "full");
      }, LONG_PRESS);
    },
    onPointerMove: (e) => {
      const from = start.current;
      if (from !== null && Math.hypot(e.clientX - from.x, e.clientY - from.y) > SLOP) clear();
    },
    onPointerUp: () => {
      clear();
      if (opened.current) swallowNextClick();
      opened.current = false;
    },
    onPointerCancel: () => {
      clear();
      opened.current = false;
    },
    onPointerEnter: (e) => {
      if (e.pointerType !== "mouse" || e.buttons !== 0) return;
      clear();
      timer.current = setTimeout(() => latest.current.open(id, "preview"), HOVER);
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
