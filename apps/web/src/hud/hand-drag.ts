// Drag to play (M3-04c; the owner asked for it, 2026-11-23): press a hand card and move it up onto the table, then let
// go, and it's played or cast as a second tap would [R]. From the open hand or the collapsed one. Pointer events, so a
// mouse and a finger alike. The card lifts as soon as the drag starts; letting go below the line, or Escape, puts it
// down again. The card following the finger is M3-07's animation; for now the lifted card and a cue show what happens.

import type { ObjectId } from "@mtg/engine";
import { useEffect, useRef, useState } from "react";
import type { BoardModel } from "../board-model/board-model.ts";

/** px: how far up a press must move to be a drag at all, and how far to be let go "on the table" (D-158). */
const START = 12;
const DROP = 60;

/** What a drag does: lift the card as it starts, play it when let go on the table, or put it down. */
export type HandDragCallbacks = { lift: (id: ObjectId) => void; drop: (id: ObjectId) => void; cancel: () => void };

export type HandDrag = {
  /** The card being dragged, and whether letting go now would play it. */
  dragging: { id: ObjectId; armed: boolean } | null;
  /**
   * On a hand card's region (`id` is its card) or the collapsed hand (no `id`: the card under the pointer is found by
   * where it's drawn): a press there may become a drag.
   */
  onPointerDown: (e: React.PointerEvent<HTMLElement>, id?: ObjectId) => void;
};

export function useHandDrag(model: BoardModel, on: HandDragCallbacks): HandDrag {
  const [dragging, setDragging] = useState<HandDrag["dragging"]>(null);
  // The latest callbacks, for listeners added when the press began.
  const latest = useRef(on);
  latest.current = on;
  // The drag under way's way to end, for an unmount mid-drag: no listener may outlive the hand.
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);
  return {
    dragging,
    onPointerDown: (e, given) => {
      // One finger, or the mouse's main button: a second finger or a right-click is never a drag.
      if (e.button !== 0 || !e.isPrimary || stopRef.current !== null) return;
      const id = given ?? handCardAt(model, e);
      if (id === null) return;
      const pointer = e.pointerId;
      const from = e.clientY;
      let lifted = false;
      let armed = false;
      // Followed on the window, not the card: lifting the card redraws the hand, and the element pressed goes away.
      const move = (m: PointerEvent) => {
        if (m.pointerId !== pointer) return;
        // The button let go somewhere a release wasn't seen (a context menu, another window): the drag is over.
        if (m.buttons === 0) return cancel();
        const up = from - m.clientY;
        if (!lifted && up < START) return;
        if (!lifted) {
          lifted = true;
          latest.current.lift(id);
        } else if (armed === up >= DROP) return; // only a change of state redraws, not every move
        armed = up >= DROP;
        setDragging({ id, armed });
      };
      const release = (u: PointerEvent) => {
        if (u.pointerId !== pointer) return;
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
      const onEscape = (k: KeyboardEvent) => {
        if (k.key !== "Escape") return;
        k.stopPropagation();
        cancel();
      };
      const stop = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", release);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("keydown", onEscape, { capture: true });
        stopRef.current = null;
        setDragging(null);
      };
      stopRef.current = stop;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", release);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("keydown", onEscape, { capture: true });
    },
  };
}

/**
 * A drag's release can also fire a click, on the card or on the table where it was let go: a tap on the card, or the
 * table's "put things down". Neither is meant, so that click is stopped before anything sees it. A touch release often
 * fires none: then the next press, or a moment's wait, takes the listener away, so a real click is never eaten.
 */
function swallowNextClick(): void {
  const stop = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    done();
  };
  const done = () => {
    window.removeEventListener("click", stop, { capture: true });
    window.removeEventListener("pointerdown", done, { capture: true });
  };
  window.addEventListener("click", stop, { capture: true });
  window.addEventListener("pointerdown", done, { capture: true });
  setTimeout(done, 300);
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
