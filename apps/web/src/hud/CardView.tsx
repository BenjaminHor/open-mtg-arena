// The card view (M3-04c; arena-research.md, "The Examined view"): a card shown large, with its hangers beside it
// (`interaction/card-details.ts`). The full image's printed credit is the artist's credit (D-155). Opened by a
// long-press, a right-click or the "i" key as a full view, closed by a tap anywhere or Escape; a mouse resting on a
// card shows the same as a preview that passes taps through and goes when the mouse leaves, as Arena's desktop client
// does (D-160).

import type { CardDetails } from "../interaction/card-details.ts";
import { ManaText } from "./ManaText.tsx";

export type Inspected = { mode: "full" | "preview"; details: CardDetails };

export function CardView({ inspected, close }: { inspected: Inspected; close: () => void }) {
  const { mode, details } = inspected;
  const body = (
    <div className={`card-view-body ${mode}`}>
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
            {details.oracleText.split("\n").map((line) => (
              <p key={line}>
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
    // A tap anywhere closes it: the view is for reading, nothing in it is pressed.
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes it (App.tsx), as the close button does
    // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop only closes the view
    <div className="card-view full" onClick={close}>
      <section role="dialog" aria-modal="true" aria-label={details.name}>
        {body}
        <button type="button" className="card-view-close" onClick={close}>
          Close
        </button>
      </section>
    </div>
  );
}
