// The cards a tap can act on, as real buttons laid over the canvas where the board model's tap regions are (M3-04b):
// one path for touch, mouse and keyboard (Tab to a card, Enter or Space to use it, a visible focus ring), with a label
// that says what it does for screen readers and tests. Invisible but for the focus ring and a press: the card under it
// is drawn on the canvas.

import type { ObjectId } from "@mtg/engine";
import type { BoardModel } from "../board-model/board-model.ts";
import type { Controls } from "../interaction/controls.ts";
import { place } from "./place.ts";

type Props = {
  model: BoardModel;
  controls: Controls;
  /** While an action is on its way to the worker, nothing takes another (ui.md: no double sends). */
  busy: boolean;
  onTap: (id: ObjectId) => void;
  /** The collapsed hand is one button that opens it. */
  onHand: () => void;
  handOpen: boolean;
};

export function CardButtons({ model, controls, busy, onTap, onHand, handOpen }: Props) {
  const hand = model.overlay.hand;
  return (
    <>
      {hand !== null && !handOpen && (
        <button type="button" className="tap-region" style={place(hand)} aria-label="Open your hand" onClick={onHand} />
      )}
      {model.regions.map(({ id, rect }) => {
        const control = controls.cards[id];
        if (control === undefined) return null;
        return (
          <button
            key={id}
            type="button"
            className="tap-region"
            style={place(rect)}
            aria-label={control.label}
            aria-disabled={busy}
            onClick={() => !busy && onTap(id)}
          />
        );
      })}
    </>
  );
}
