// What makes the stack read as the stack (D-174; the owner: "when there's something on the stack to resolve, it's not
// immediately obvious that there's something on the stack", and Forge's stack list "but more polished"): a header over
// it from one object on, the top object ringed with a tag under it saying whose it is, and each object under the top
// named in words on its strip, a row of a list, rather than by the card frame's tiny title. Whose is said in words; the
// ring is a neutral light, so it never reads as the turn's colour, a red frame or a target's outline (UX review).
// Everything is placed at the board model's rects (`board-model/stack-labels.ts`); the canvas draws the cards.

import type { SeatView } from "@mtg/engine";
import type { BoardCard, BoardModel } from "../board-model/board-model.ts";
import { place } from "./place.ts";
import type { Browsing } from "./ZoneBrowser.tsx";

type Props = {
  shown: SeatView;
  model: BoardModel;
  browse: (browsing: Browsing) => void;
};

export function StackLabels({ shown, model, browse }: Props) {
  const labels = model.overlay.stack;
  const drawn = model.cards.filter((c) => c.zone === "stack");
  const top = drawn.at(-1);
  if (labels === null || top === undefined) return null;
  const count = shown.view.zones.stack.length;
  const byId = new Map(drawn.map((c) => [c.id, c]));
  return (
    <>
      <button
        type="button"
        className="stack-header"
        style={place(labels.header)}
        // Says what the ring and the tag show, for a screen reader (they're decoration to it).
        aria-label={`The stack, ${count} ${count === 1 ? "object" : "objects"}, ${whose(top).toLowerCase()} ${label(top)} on top: show them all`}
        onClick={() => browse({ kind: "stack" })}
      >
        Stack <span className="stack-count">{count}</span>
      </button>
      {labels.ring !== null && (
        <div
          // A new element for each top object, so its fade-in plays again.
          key={`ring-${top.id}`}
          className="stack-ring"
          style={{ ...place(labels.ring.rect), borderRadius: labels.ring.radius }}
          aria-hidden="true"
        />
      )}
      {labels.tag !== null && (
        <div key={`tag-${top.id}`} className="stack-tag" style={place(labels.tag)} aria-hidden="true">
          {whose(top)}
        </div>
      )}
      {labels.rows.map((row) => {
        const card = byId.get(row.id);
        if (card === undefined) return null;
        return (
          <div key={row.id} className="stack-row" style={place(row.rect)} aria-hidden="true">
            {labels.rowsSayWhose && <span className="stack-whose">{card.mine ? "You" : "Opp"}</span>}
            <span className="stack-name">{label(card)}</span>
          </div>
        );
      })}
    </>
  );
}

/** Whose the object is, as the tag says it. Two players for now; with more, the controller by name (`names.ts`). */
function whose(card: BoardCard): string {
  return card.mine ? "Yours" : "Opponent's";
}

/** A spell by its name, an ability as its source's ("Prodigal Pyromancer ability"); a nameless one is just "Ability". */
function label(card: BoardCard): string {
  return card.ability && card.name !== "Ability" ? `${card.name} ability` : card.name;
}
