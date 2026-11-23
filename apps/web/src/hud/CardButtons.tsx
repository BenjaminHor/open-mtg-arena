// The cards a tap can act on, as real buttons laid over the canvas where the board model's tap regions are (M3-04b):
// one path for touch, mouse and keyboard (Tab to a card, Enter or Space to use it, a visible focus ring), with a label
// that says what it does for screen readers and tests. Invisible but for the focus ring and a press: the card under it
// is drawn on the canvas.

import type { ObjectId } from "@mtg/engine";
import type { BoardModel } from "../board-model/board-model.ts";
import type { Controls } from "../interaction/controls.ts";
import { type InspectOpen, useCardInspect } from "./card-inspect.ts";
import { type HandDragCallbacks, useHandDrag } from "./hand-drag.ts";
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
  /** Drag to play (`hand-drag.ts`): a hand card lifted by a drag, let go on the table, or put down. */
  drag: HandDragCallbacks;
  /** The card view (`card-inspect.ts`): open it for a card, or close a hover's preview. */
  inspect: { open: InspectOpen; closePreview: () => void };
};

export function CardButtons({ model, controls, busy, onTap, onHand, handOpen, selection, drag, inspect }: Props) {
  const hand = model.overlay.hand;
  const handDrag = useHandDrag(model, drag);
  const inspectOn = useCardInspect((id, mode) => {
    // A long-press on a hand card is looking, not the start of a drag.
    if (mode === "full") handDrag.abort();
    inspect.open(id, mode);
  }, inspect.closePreview);
  const names = new Map(model.cards.map((c) => [c.id, c.name]));
  const inHand = new Set(model.cards.filter((c) => c.zone === "hand").map((c) => c.id));
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
        // Every card can be looked at (long-press, right-click, hover): the one a tap acts on, else the pile's front.
        const looked = (actor ?? members[0] ?? id) as ObjectId;
        const look = inspectOn(looked);
        if (actor === undefined || control === undefined) {
          return (
            // Focusable, so the keyboard can look at any card ("i"), not only the ones a tap acts on (ui.md).
            <div
              key={id}
              className="inspect-region"
              role="img"
              // biome-ignore lint/a11y/noNoninteractiveTabindex: focus is how the keyboard picks a card to look at
              tabIndex={0}
              aria-label={names.get(looked) ?? "Card"}
              style={{ ...place(rect), zIndex: layer }}
              {...look}
            />
          );
        }
        return (
          <button
            key={id}
            type="button"
            className="tap-region"
            style={{ ...place(rect), zIndex: layer }}
            aria-label={spoken(control.label)}
            aria-disabled={busy}
            onClick={() => !busy && onTap(actor)}
            {...look}
            onPointerDown={(e) => {
              look.onPointerDown(e);
              if (inHand.has(id) && !busy) handDrag.onPointerDown(e, actor);
            }}
          />
        );
      })}
      {/* After the board's regions, so Tab reaches the hand after the cards above it. */}
      {hand !== null && !handOpen && (
        <button
          type="button"
          className="tap-region"
          style={place(hand)}
          aria-label="Open your hand"
          onClick={onHand}
          onPointerDown={busy ? undefined : (e) => handDrag.onPointerDown(e)}
        />
      )}
      {lifted !== undefined && (again?.kind === "send" || handDrag.dragging !== null) && (
        <div
          className={`tap-again${handDrag.dragging?.armed ? " armed" : ""}`}
          style={place({ x: lifted.x + 8, y: lifted.y + lifted.height - 34, width: lifted.width - 16, height: 26 })}
        >
          {cue(handDrag.dragging, again)}
        </div>
      )}
      {/* The card on the stack takes a tap for itself, so a tap on it never lands on a card hidden under it. */}
      {model.cards
        .filter((c) => c.zone === "stack")
        .map((c) => (
          // biome-ignore lint/a11y/noStaticElementInteractions: it only stops a tap; the card has no action of its own
          // biome-ignore lint/a11y/useKeyWithClickEvents: nothing to do from the keyboard
          <div
            key={`stack-${c.id}`}
            className="tap-shield"
            style={place(c)}
            onClick={(e) => e.stopPropagation()}
            {...inspectOn(c.id as ObjectId)}
          />
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

/**
 * What the lifted card says: a second tap plays it, or, while it's dragged, whether letting go will, whether it opens a
 * choice of what to do, or that it can't be played now (no mana, the wrong moment).
 */
function cue(dragging: { armed: boolean } | null, tap: Controls["cards"][ObjectId]["tap"] | undefined): string {
  const verb = tap?.kind === "send" ? (tap.choice.label.split(" ")[0]?.toLowerCase() ?? "play") : null;
  if (dragging === null) return `Tap again to ${verb ?? "play"}`;
  if (tap?.kind === "menu") return dragging.armed ? "Release to choose" : "Drag up to choose";
  if (verb === null) return "Can't play it now";
  return dragging.armed ? `Release to ${verb}` : `Drag up to ${verb}`;
}
