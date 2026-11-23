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
  /** The lifted hand card, if any: it says what a second tap does. */
  selection: ObjectId | null;
};

export function CardButtons({ model, controls, busy, onTap, onHand, handOpen, selection }: Props) {
  const hand = model.overlay.hand;
  // A lifted hand card that a second tap plays: say so on it, "Tap again to cast" (the UX review's cue).
  const lifted = model.cards.find((c) => c.zone === "hand" && c.id === selection);
  const again = selection === null ? undefined : controls.cards[selection]?.tap;
  // One layer of its own (a stacking context), so the regions' z-indexes order them among themselves only, under the
  // menus, prompt and buttons the HUD draws after it.
  return (
    <div className="tap-layer">
      {inReadingOrder(model.regions).map(({ id, rect, members, layer }) => {
        // A pile acts through its front card, or the next card in it that has something to do.
        const actor = members.find((m) => controls.cards[m] !== undefined);
        const control = actor === undefined ? undefined : controls.cards[actor];
        if (actor === undefined || control === undefined) return null;
        return (
          <button
            key={id}
            type="button"
            className="tap-region"
            style={{ ...place(rect), zIndex: layer }}
            aria-label={spoken(control.label)}
            aria-disabled={busy}
            onClick={() => !busy && onTap(actor)}
          />
        );
      })}
      {/* After the board's regions, so Tab reaches the hand after the cards above it. */}
      {hand !== null && !handOpen && (
        <button type="button" className="tap-region" style={place(hand)} aria-label="Open your hand" onClick={onHand} />
      )}
      {lifted !== undefined && again?.kind === "send" && (
        <div
          className="tap-again"
          style={place({ x: lifted.x + 8, y: lifted.y + lifted.height - 34, width: lifted.width - 16, height: 26 })}
        >
          Tap again to {again.choice.label.split(" ")[0]?.toLowerCase()}
        </div>
      )}
      {/* The card on the stack takes a tap for itself, so a tap on it never lands on a card hidden under it. */}
      {model.cards
        .filter((c) => c.zone === "stack")
        .map((c) => (
          // biome-ignore lint/a11y/noStaticElementInteractions: it only stops a tap; the card has no action of its own
          // biome-ignore lint/a11y/useKeyWithClickEvents: nothing to do from the keyboard
          <div key={`stack-${c.id}`} className="tap-shield" style={place(c)} onClick={(e) => e.stopPropagation()} />
        ))}
    </div>
  );
}

/**
 * The regions in the order Tab visits them: top row to bottom, left to right in a row, so focus moves the way the
 * screen reads (ui.md, "Mouse and keyboard too"). Overlapping regions keep their stacking from the model's order (a pile
 * over its neighbour, the lifted hand card over the fan) through a z-index, so a tap lands where it did before.
 */
function inReadingOrder(regions: BoardModel["regions"]) {
  // Cards in a row differ in height (tapped, lifted, attacking), so a row is all regions whose centres are this near.
  const sameRow = 24;
  const centre = (r: BoardModel["regions"][number]) => r.rect.y + r.rect.height / 2;
  const byHeight = regions.map((r, layer) => ({ ...r, layer: layer + 1 })).sort((a, b) => centre(a) - centre(b));
  const rows: (typeof byHeight)[] = [];
  for (const r of byHeight) {
    const row = rows.at(-1);
    const first = row?.[0];
    if (row !== undefined && first !== undefined && centre(r) - centre(first) < sameRow) row.push(r);
    else rows.push([r]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.rect.x - b.rect.x));
}

/** A label as a screen reader should say it: mana symbols as words ("{T}" is "tap", "{G}" is "G mana"), as ManaText. */
function spoken(label: string): string {
  return label.replace(/\{([^}]+)\}/g, (_, symbol: string) => (symbol === "T" ? "tap" : `${symbol} mana`));
}
