// Drag to play (M3-04c; the owner asked for it, 2026-11-23): press a hand card and move it up onto the table, then let
// go, and it's played or cast as a second tap would [R]. From the open hand or the collapsed one. Pointer events, so a
// mouse and a finger alike. The card lifts as soon as the drag starts; letting go below the line, or Escape, puts it
// down again. The card following the finger is M3-07's animation; for now the lifted card and a cue show what happens.

import type { ObjectId } from "@mtg/engine";
import { useEffect, useRef, useState } from "react";
import type { BoardModel } from "../board-model/board-model.ts";
import { swallowNextClick } from "./swallow-click.ts";

/**
 * px: how far up a press must move to be a drag at all; how far at least to be let go "on the table", which also
 * means above the open hand's top edge, by `CLEAR` (D-158).
 */
const START = 12;
const DROP = 60;
const CLEAR = 8;

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
  /** Forget a press that hasn't become a drag yet: a long-press opened the card view, so it's looking, not playing. */
  abort: () => void;
};

export function useHandDrag(model: BoardModel, on: HandDragCallbacks): HandDrag {
  const [dragging, setDragging] = useState<HandDrag["dragging"]>(null);
  // The latest callbacks, for listeners added when the press began.
  const latest = useRef(on);
  latest.current = on;
  // The board model as it is now: the hand opens as a drag starts, and "on the table" means above the open hand.
  const board = useRef(model);
  board.current = model;
  // The drag under way's way to end, for an unmount mid-drag: no listener may outlive the hand.
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);
  return {
    dragging,
    abort: () => stopRef.current?.(),
    onPointerDown: (e, given) => {
      // One finger, or the mouse's main button: a second finger or a right-click is never a drag.
      if (e.button !== 0 || !e.isPrimary || stopRef.current !== null) return;
      const id = given ?? handCardAt(model, e);
      if (id === null) return;
      const pointer = e.pointerId;
      const from = e.clientY;
      const hud = e.currentTarget.closest(".hud");
      const top = hud?.getBoundingClientRect().top ?? 0;
      // On the table: far enough up, and above the hand's top edge (the open hand reaches well up the screen).
      const onTable = (y: number) => from - y >= DROP && y - top < handTop(board.current, id) - CLEAR;
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
          // Held on the board's stable layer from here: lifting the card redraws the hand, and the element pressed
          // goes away, which on some browsers (iOS Safari) would leave the pointer's events with nowhere to go.
          if (hud?.hasPointerCapture(pointer) === false) hud.setPointerCapture(pointer);
          latest.current.lift(id);
        } else if (armed === onTable(m.clientY)) return; // only a change of state redraws, not every move
        armed = onTable(m.clientY);
        setDragging({ id, armed });
      };
      const release = (u: PointerEvent) => {
        if (u.pointerId !== pointer) return;
        stop();
        if (!lifted) return;
        swallowNextClick();
        if (onTable(u.clientY)) latest.current.drop(id);
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

/**
 * The top edge of the person's hand as drawn now (open or collapsed), in the board's pixels, leaving out the card being
 * dragged: lifted, it's drawn large near the top of the screen, not in the hand's row.
 */
function handTop(model: BoardModel, dragged: ObjectId): number {
  const tops = model.cards.filter((c) => c.zone === "hand" && c.mine && c.id !== dragged).map((c) => c.y);
  return tops.length === 0 ? model.height : Math.min(...tops);
}
