// Drag to play (M3-04c; the owner asked for it, 2026-11-23): press a hand card and move it up onto the table, then let
// go, and it's played or cast as a second tap would [R]. From the open hand or the collapsed one. Pointer events, so a
// mouse and a finger alike. The card lifts as soon as the drag starts; letting go below the line puts it down again.
// The card following the finger is M3-07's animation; for now the lifted card and a cue show what will happen.

import type { ObjectId } from "@mtg/engine";
import { useRef, useState } from "react";
import type { BoardModel } from "../board-model/board-model.ts";

/** px: how far up a press must move to be a drag at all, and how far to be let go "on the table". */
const START = 12;
const DROP = 60;

export type HandDrag = {
  /** The card being dragged, and whether letting go now would play it. */
  dragging: { id: ObjectId; armed: boolean } | null;
  /** On a hand card (or the collapsed hand): a press there may become a drag. */
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
};

type On = { lift: (id: ObjectId) => void; drop: (id: ObjectId) => void; cancel: () => void };

export function useHandDrag(model: BoardModel, on: On): HandDrag {
  const [dragging, setDragging] = useState<HandDrag["dragging"]>(null);
  // The latest callbacks, for listeners added when the press began.
  const latest = useRef(on);
  latest.current = on;
  return {
    dragging,
    onPointerDown: (e) => {
      const id = handCardAt(model, e);
      if (id === null) return;
      const from = e.clientY;
      let lifted = false;
      // Followed on the window, not the card: lifting the card redraws the hand, and the element pressed goes away.
      const move = (m: PointerEvent) => {
        const up = from - m.clientY;
        if (!lifted && up < START) return;
        if (!lifted) {
          lifted = true;
          latest.current.lift(id);
        }
        setDragging({ id, armed: up >= DROP });
      };
      const release = (u: PointerEvent) => {
        stop();
        if (!lifted) return;
        swallowNextClick();
        if (from - u.clientY >= DROP) latest.current.drop(id);
        else latest.current.cancel();
      };
      const cancel = () => {
        stop();
        if (lifted) latest.current.cancel();
      };
      const stop = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", release);
        window.removeEventListener("pointercancel", cancel);
        setDragging(null);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", release);
      window.addEventListener("pointercancel", cancel);
    },
  };
}

/**
 * A drag's release also fires a click, on the card or on the table where it was let go: a tap on the card, or the
 * table's "put things down". Neither is meant, so the one click right after a drag is stopped before anything sees it.
 */
function swallowNextClick(): void {
  const stop = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener("click", stop, { capture: true, once: true });
  // If no click comes (a touch release can fire none), the listener mustn't eat a later, real one.
  setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 300);
}

/** The hand card under the pointer, the front-most where cards overlap (the model lists them back to front). */
function handCardAt(model: BoardModel, e: React.PointerEvent<HTMLElement>): ObjectId | null {
  const board = e.currentTarget.closest(".hud")?.getBoundingClientRect();
  if (board === undefined) return null;
  const x = e.clientX - board.left;
  const y = e.clientY - board.top;
  const under = model.cards.filter(
    (c) => c.zone === "hand" && c.mine && x >= c.x && x <= c.x + c.width && y >= c.y && y <= c.y + c.height,
  );
  return (under.at(-1)?.id as ObjectId | undefined) ?? null;
}
