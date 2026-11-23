// What makes the stack read as the stack (D-174; the owner: "when there's something on the stack to resolve, it's not
// immediately obvious that there's something on the stack", and Forge's stack list "but more polished"): a header over
// it from one object on, the top object ringed and tagged with whose it is, and each object under the top named in
// words on its strip, a row of a list, rather than by the card frame's tiny title. Words and colour together, never
// colour alone (ui.md): orange for the person's, blue for the opponent's, as Arena colours the turn [R].
// Everything is placed at the board model's rects (`board-model/stack.ts`); the canvas draws the cards themselves.

import type { SeatView } from "@mtg/engine";
import type { BoardCard, BoardModel, Rect } from "../board-model/board-model.ts";
import { place } from "./place.ts";
import type { Browsing } from "./ZoneBrowser.tsx";

type Props = {
  shown: SeatView;
  model: BoardModel;
  /** The open hand can fan over the stack's place: the labels stand down where they'd sit on its cards. */
  handOpen: boolean;
  browse: (browsing: Browsing) => void;
};

export function StackLabels({ shown, model, handOpen, browse }: Props) {
  const header = model.overlay.stackHeader;
  const drawn = model.cards.filter((c) => c.zone === "stack");
  const top = drawn.at(-1);
  if (header === null || top === undefined) return null;
  const count = shown.view.zones.stack.length;
  const labelled = drawn.map((c) => c.shows ?? c);
  const covered = handOpen && model.cards.some((h) => h.zone === "hand" && labelled.some((r) => overlaps(h, r)));
  return (
    <>
      <button
        type="button"
        className="stack-header"
        style={place(header)}
        aria-label={`The stack, ${count} ${count === 1 ? "object" : "objects"}: show them all`}
        onClick={() => browse({ kind: "stack" })}
      >
        Stack <span className="stack-count">{count}</span>
      </button>
      {!covered && (
        <>
          <div className={`stack-ring ${whoseClass(top)}`} style={place(top)} aria-hidden="true" />
          <div
            className={`stack-tag ${whoseClass(top)}`}
            style={{ left: top.x, top: top.y + top.height + 4, width: top.width }}
            aria-hidden="true"
          >
            {top.mine ? "Yours" : "Opponent's"}
          </div>
          {drawn.slice(0, -1).map((c) =>
            c.shows === null ? null : (
              <div key={c.id} className={`stack-row ${whoseClass(c)}`} style={place(c.shows)} aria-hidden="true">
                {/* A narrow row (the stack made small) keeps its width for the name; the colour, the card view and
                    the header's list still say whose it is. */}
                {c.shows.width >= 96 && <span className="stack-whose">{c.mine ? "You" : "Opp"}</span>}
                <span className="stack-name">{c.ability ? `${c.name} ability` : c.name}</span>
              </div>
            ),
          )}
        </>
      )}
    </>
  );
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function whoseClass(card: BoardCard): string {
  return card.mine ? "stack-yours" : "stack-theirs";
}
