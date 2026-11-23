// The card view (M3-04c; arena-research.md, "The Examined view"): a card shown large, with its hangers beside it
// (`interaction/card-details.ts`). The full image's printed credit is the artist's credit (D-155). Opened by a
// long-press, a right-click or the "i" key as a full view, closed by a tap anywhere or Escape; a mouse resting on a
// card shows the same as a preview that passes taps through and goes when the mouse leaves, as Arena's desktop client
// does (D-160). The card keeps a fixed place (Arena's, at the left), so a hanger coming or going never moves it.

import type { ObjectId } from "@mtg/engine";
import { useEffect, useRef, useState } from "react";
import type { CardDetails } from "../interaction/card-details.ts";
import { ManaText } from "./ManaText.tsx";

/**
 * The card being looked at, by id: what the view shows is read from the seat view each time it's drawn, so it follows
 * the game while it's open (the opponent acts meanwhile), as a card's menu does.
 */
export type Inspected = { mode: "full" | "preview"; id: ObjectId };

type Props = {
  /** What's shown, so a different card starts its image afresh: an object's id, or a revealed card's place. */
  viewKey: string;
  mode: Inspected["mode"];
  details: CardDetails;
  close: () => void;
};

export function CardView({ viewKey, mode, details, close }: Props) {
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
      <CardFace key={viewKey} details={details} />
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
  // A preview is at the left, always, where the full view is (the owner: "it should stick to just one side").
  if (mode === "preview") return <div className="card-view preview">{body}</div>;
  return (
    // A tap anywhere closes it: the view is for reading, nothing in it is pressed. The click stops here: the table under
    // it mustn't also take it as "put things down" (App's `onTable`). A right-click closes it too, as it opened it.
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes it (App.tsx), as the close button does
    // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop only closes the view
    <div
      className="card-view full"
      onClick={(e) => {
        e.stopPropagation();
        close();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // Android fires one during a long hold too, by then over this backdrop: only a mouse's right-click closes it.
        if (!isTouch(e)) close();
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

/** Whether a context menu came from a finger or a pen (a long hold), not a mouse's right button. */
export function isTouch(e: React.MouseEvent): boolean {
  const type = (e.nativeEvent as Partial<PointerEvent>).pointerType;
  return type === "touch" || type === "pen";
}

/**
 * The card itself: its image, and until that has loaded (or if it can't, offline), the card as text in its frame, as
 * the hand draws its own fallback (ui.md). A token has no image, so it's always the text.
 */
export function CardFace({ details }: { details: CardDetails }) {
  const [image, setImage] = useState<"loading" | "loaded" | "failed">("loading");
  const showImage = details.image !== null && image !== "failed";
  return (
    <figure className="card-view-card">
      {(!showImage || image === "loading") && (
        <div className="card-view-text">
          <p className="card-view-name">
            <span>{details.name}</span>
            <ManaText text={details.manaCost} />
          </p>
          {/* An ability's panel has its source's art, as Arena draws one [R]. */}
          {details.art != null && <img className="card-view-art" src={details.art} alt="" draggable={false} />}
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
      {showImage && details.image !== null && (
        <img
          className={image === "loaded" ? undefined : "loading"}
          src={details.image}
          alt={details.name}
          draggable={false}
          // In the zone browser's long row, only the cards scrolled near load.
          loading="lazy"
          onLoad={() => setImage("loaded")}
          onError={() => setImage("failed")}
        />
      )}
    </figure>
  );
}
