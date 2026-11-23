// The zone browser (M3-04c slice 5; arena-research.md: "clicking a graveyard or exile opens a view of every card in it",
// the opponent's too, and on a phone "tapping a zone opens a browser of its known cards with a count" [R]). A sheet over
// the board with a tab per zone and the cards in a row that scrolls sideways; a tap on a card shows it in the card view,
// and closing that comes back here. What it shows is read from the seat view each time it's drawn (`interaction/
// zones.ts`), so it follows the game while it's open; it's only for reading, so a decision arriving leaves it open.

import type { PlayerId, SeatView } from "@mtg/engine";
import { useEffect, useRef, useState } from "react";
import { cardDetails, printedDetails } from "../interaction/card-details.ts";
import { browserTabs, type ZoneCard, type ZoneName } from "../interaction/zones.ts";
import { CardView } from "./CardView.tsx";

/** The zone being browsed, by whose and which: re-read each time, as the card view is (D-161). */
export type Browsing = { player: PlayerId; zone: ZoneName };

type Props = {
  shown: SeatView;
  browsing: Browsing;
  choose: (zone: ZoneName) => void;
  close: () => void;
};

export function ZoneBrowser({ shown, browsing, choose, close }: Props) {
  const tabs = browserTabs(shown, browsing.player);
  // A reveal that ended takes its tab with it: back to the graveyard.
  const tab = tabs.find((t) => t.zone === browsing.zone) ?? tabs[0];
  const [looking, setLooking] = useState<string | null>(null);
  const card = tab?.cards.find((c) => c.key === looking) ?? null;
  const details = card === null ? null : detailsOf(shown, card);
  // The sheet is modal: focus moves into it and goes back where it was when it closes (ui.md, "Mouse and keyboard
  // too"); Escape closes the card view over it first, then the sheet.
  const sheet = useRef<HTMLElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    sheet.current?.querySelector<HTMLElement>("[aria-selected='true']")?.focus();
    return () => before?.focus();
  }, []);
  const lookingNow = details !== null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (lookingNow) setLooking(null);
      else close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lookingNow, close]);
  if (tab === undefined) return null;
  const whose = browsing.player === shown.player ? "Your" : "Opponent's";
  return (
    // A tap outside the sheet closes it. The click stops here: the table under it mustn't also take it.
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes it (above), as the Close button does
    // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop only closes the browser
    <div
      className="zone-browser"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) close();
      }}
    >
      <section ref={sheet} role="dialog" aria-modal="true" aria-label={`${whose} zones`} onKeyDown={trapTab}>
        <div className="zone-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.zone}
              type="button"
              role="tab"
              aria-selected={t.zone === tab.zone}
              onClick={() => {
                setLooking(null);
                choose(t.zone);
              }}
            >
              {t.label}
            </button>
          ))}
          <button type="button" className="zone-close" onClick={close}>
            Close
          </button>
        </div>
        {tab.cards.length === 0 ? (
          <p className="zone-empty">No cards</p>
        ) : (
          <ul
            className="zone-row"
            aria-label={`${whose} ${tab.label}`}
            // A mouse wheel scrolls the row sideways: it has nowhere to go up or down.
            onWheel={(e) => {
              if (e.deltaX === 0) e.currentTarget.scrollLeft += e.deltaY;
            }}
          >
            {tab.cards.map((c) => (
              <li key={c.key}>
                <button type="button" className="zone-card" aria-label={c.name} onClick={() => setLooking(c.key)}>
                  <CardImage card={c} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {card !== null && details !== null && (
        <CardView viewKey={card.key} mode="full" details={details} close={() => setLooking(null)} />
      )}
    </div>
  );
}

function detailsOf(shown: SeatView, card: ZoneCard) {
  if (card.id !== null) return cardDetails(shown, card.id);
  return card.oracleId === null ? null : printedDetails(card.oracleId);
}

/** A card's image, and its name in its place until the image has loaded (or if it can't, offline). */
function CardImage({ card }: { card: ZoneCard }) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");
  return (
    <>
      {state !== "loaded" && <span className="zone-card-name">{card.name}</span>}
      {card.image !== null && state !== "failed" && (
        <img
          src={card.image}
          alt=""
          draggable={false}
          className={state === "loaded" ? undefined : "loading"}
          onLoad={() => setState("loaded")}
          onError={() => setState("failed")}
        />
      )}
    </>
  );
}

/** Tab stays inside the sheet: nothing behind a modal is reachable (ui.md, "Mouse and keyboard too"). */
function trapTab(e: React.KeyboardEvent<HTMLElement>): void {
  if (e.key !== "Tab") return;
  const all = [...e.currentTarget.querySelectorAll<HTMLElement>("button")];
  const first = all[0];
  const last = all[all.length - 1];
  if (first === undefined || last === undefined) return;
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
