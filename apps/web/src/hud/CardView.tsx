// The card view (M3-04c; arena-research.md, "The Examined view"): a card shown large, with its hangers beside it
// (`interaction/card-details.ts`). The full image's printed credit is the artist's credit (D-155). Opened by a
// long-press, a right-click or the "i" key as a full view, closed by a tap anywhere or Escape; a mouse resting on a
// card shows the same as a preview that passes taps through and goes when the mouse leaves, as Arena's desktop client
// does (D-160).

import type { ObjectId } from "@mtg/engine";
import { useEffect, useRef } from "react";
import type { CardDetails } from "../interaction/card-details.ts";
import { ManaText } from "./ManaText.tsx";

/**
 * The card being looked at, by id: what the view shows is read from the seat view each time it's drawn, so it follows
 * the game while it's open (the opponent acts meanwhile), as a card's menu does.
 */
export type Inspected = { mode: "full" | "preview"; id: ObjectId };

type Props = { mode: Inspected["mode"]; details: CardDetails; close: () => void };

export function CardView({ mode, details, close }: Props) {
  // The full view is modal: focus moves to its Close button, so Enter or Space can't press a card behind it, and goes
  // back where it was when the view closes (ui.md, "Mouse and keyboard too").
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (mode !== "full") return;
    const before = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => before?.focus();
  }, [mode]);
  const body = (
    <div className="card-view-body">
      <figure className="card-view-card">
        {details.image !== null ? (
          <img src={details.image} alt={details.name} />
        ) : (
          // No image (a token): the card as text, in its frame.
          <div className="card-view-text">
            <p className="card-view-name">
              <span>{details.name}</span>
              <ManaText text={details.manaCost} />
            </p>
            <p className="card-view-type">{details.typeLine}</p>
            {details.oracleText.split("\n").map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the lines are fixed text, never reordered
              <p key={i}>
                <ManaText text={line} />
              </p>
            ))}
            {details.powerToughness !== null && <p className="card-view-pt">{details.powerToughness}</p>}
          </div>
        )}
      </figure>
      {details.hangers.length > 0 && (
        <ul className="card-view-hangers">
          {details.hangers.map((hanger) => (
            <li key={`${hanger.title} ${hanger.text}`}>
              <strong>{hanger.title}</strong>
              <ManaText text={hanger.text} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  if (mode === "preview") return <div className="card-view preview">{body}</div>;
  return (
    // A tap anywhere closes it: the view is for reading, nothing in it is pressed. The click stops here: the table under
    // it mustn't also take it as "put things down" (App's `onTable`).
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes it (App.tsx), as the close button does
    // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop only closes the view
    <div
      className="card-view full"
      onClick={(e) => {
        e.stopPropagation();
        close();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={details.name}
        // Tab stays on Close: nothing behind a modal view is reachable.
        onKeyDown={(e) => e.key === "Tab" && e.preventDefault()}
      >
        {body}
        <button type="button" className="card-view-close" ref={closeButton} onClick={close}>
          Close
        </button>
      </section>
    </div>
  );
}
