// The zone browser (M3-04c slice 5; arena-research.md: "clicking a graveyard or exile opens a view of every card in it",
// the opponent's too, and on a phone "tapping a zone opens a browser of its known cards with a count" [R]). A sheet over
// the board with a tab per zone and the cards in a row that scrolls sideways; a tap on a card shows it in the card view,
// and closing that comes back here. What it shows is read from the seat view each time it's drawn (`interaction/
// zones.ts`), so it follows the game while it's open; it's only for reading, so a decision arriving leaves it open.

import type { PlayerId, SeatView } from "@mtg/engine";
import { useEffect, useRef, useState } from "react";
import { type CardDetails, cardDetails, printedDetails } from "../interaction/card-details.ts";
import { promptTitle } from "../interaction/prompt-text.ts";
import { type BrowserTab, browserTabs, stackCards, type ZoneCard, type ZoneName } from "../interaction/zones.ts";
import { CardFace, CardView } from "./CardView.tsx";

/**
 * What's being browsed, re-read each time, as the card view is (D-161): one of a player's zones, by whose and which, or
 * the whole stack (shared, so no one's: D-169).
 */
export type Browsing = { kind: "player"; player: PlayerId; zone: ZoneName } | { kind: "stack" };

type Props = {
  shown: SeatView;
  browsing: Browsing;
  choose: (zone: ZoneName) => void;
  close: () => void;
};

export function ZoneBrowser({ shown, browsing, choose, close }: Props) {
  const tabs: BrowserTab[] = browsing.kind === "player" ? browserTabs(shown, browsing.player) : [];
  // A reveal that ended takes its tab with it: back to the graveyard.
  const tab = browsing.kind === "player" ? (tabs.find((t) => t.zone === browsing.zone) ?? tabs[0]) : undefined;
  const cards = browsing.kind === "stack" ? stackCards(shown) : (tab?.cards ?? []);
  const [looking, setLooking] = useState<string | null>(null);
  const card = cards.find((c) => c.key === looking) ?? null;
  const details = card === null ? null : detailsOf(shown, card);
  // The sheet is modal: focus moves into it and goes back where it was when it closes (ui.md, "Mouse and keyboard
  // too"); Escape closes the card view over it first, then the sheet.
  const sheet = useRef<HTMLElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    sheet.current?.querySelector<HTMLElement>("[aria-selected='true'], .zone-close")?.focus();
    return () => before?.focus();
  }, []);
  // Focus never leaves it: a click on the sheet's padding (focus to the page), a tab or card that's gone, or a prompt
  // arriving behind it and taking focus would otherwise let Tab and Enter reach the board under it.
  const root = useRef<HTMLDivElement>(null);
  const lookingNow = details !== null;
  useEffect(() => {
    const inside = () => {
      const at = root.current;
      return (
        at?.querySelector<HTMLElement>(".card-view-close") ??
        at?.querySelector<HTMLElement>("[aria-selected='true'], .zone-close")
      );
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab" && !root.current?.contains(document.activeElement)) {
        e.preventDefault();
        inside()?.focus();
      }
      if (e.key !== "Escape") return;
      if (lookingNow) setLooking(null);
      else close();
    };
    const onFocus = (e: FocusEvent) => {
      if (root.current?.isConnected && !root.current.contains(e.target as Node)) inside()?.focus();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
    };
  }, [lookingNow, close]);
  // A reveal that ended took its tab: the graveyard's is the one shown now, so it's the one held (a reveal coming back
  // doesn't jump to it), and it takes the focus the gone tab had.
  const fellBack = browsing.kind === "player" && tab !== undefined && tab.zone !== browsing.zone;
  useEffect(() => {
    if (!fellBack || tab === undefined) return;
    choose(tab.zone);
    root.current?.querySelector<HTMLElement>("[aria-selected='true']")?.focus();
  }, [fellBack, tab, choose]);
  // A stack that has resolved away leaves nothing to read: the browser goes with it.
  const stackGone = browsing.kind === "stack" && cards.length === 0;
  useEffect(() => {
    if (stackGone) close();
  }, [stackGone, close]);
  // A tap outside the sheet closes it, but only a press that began there: a long-press's release, or a finger that
  // slid off a card, isn't one.
  const pressedBackdrop = useRef(false);
  if (browsing.kind === "player" && tab === undefined) return null;
  const mine = browsing.kind === "player" && browsing.player === shown.player;
  const title =
    browsing.kind === "stack" ? `The stack, ${cards.length}` : `${mine ? "Your" : "Opponent's"} ${tab?.label ?? ""}`;
  // The game goes on under the sheet: a decision that's come for the person says so here, as the dimmed prompt would.
  const decision = shown.view.decision;
  const waiting = decision !== null && decision.kind !== "priority" && shown.view.result === null;
  return (
    // The click stops here: the table under it mustn't also take it.
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes it (above), as the Close button does
    // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop only closes the browser
    <div
      ref={root}
      className="zone-browser"
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget && pressedBackdrop.current) close();
        pressedBackdrop.current = false;
      }}
    >
      <section
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-label={browsing.kind === "stack" ? "The stack" : `${mine ? "Your" : "Opponent's"} zones`}
        onKeyDown={trapTab}
      >
        <div className="zone-tabs" role="tablist">
          <span className="zone-whose" aria-hidden={browsing.kind === "player"}>
            {browsing.kind === "stack" ? `The stack, top first: ${cards.length}` : mine ? "You" : "Opponent"}
          </span>
          {tabs.map((t) => (
            <button
              key={t.zone}
              type="button"
              role="tab"
              aria-selected={t.zone === tab?.zone}
              onClick={() => {
                setLooking(null);
                choose(t.zone);
              }}
            >
              {t.label}
            </button>
          ))}
          {waiting && (
            <span className="zone-waiting" role="status">
              Waiting for you: {promptTitle(shown)}
            </span>
          )}
          <button type="button" className="zone-close" onClick={close}>
            Close
          </button>
        </div>
        {cards.length === 0 ? (
          <p className="zone-empty">No cards</p>
        ) : (
          <ul
            className="zone-row"
            aria-label={title}
            // A mouse wheel scrolls the row sideways: it has nowhere to go up or down.
            onWheel={(e) => {
              // Firefox counts a notch in lines.
              if (e.deltaX === 0) e.currentTarget.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 16 : 1);
            }}
          >
            {cards.map((c, i) => (
              <li key={c.key}>
                {/* Top first: the first resolves next (CR 608.1). */}
                {browsing.kind === "stack" && i === 0 && <span className="zone-next">Resolves next</span>}
                <button
                  type="button"
                  className="zone-card"
                  aria-label={c.name}
                  onClick={() => setLooking(c.key)}
                  // A right-click or a long hold looks too, as on any card, not the browser's image menu.
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setLooking(c.key);
                  }}
                >
                  <CardImage card={c} details={detailsOf(shown, c)} />
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

/**
 * A card in the row: its image, and under it until that has loaded (or if it can't, offline) the card drawn as text,
 * as the card view and the hand fall back (ui.md). The row's image is the normal size, not the card view's large one.
 */
function CardImage({ card, details }: { card: ZoneCard; details: CardDetails | null }) {
  if (details === null) return <span className="zone-card-name">{card.name}</span>;
  return <CardFace details={{ ...details, image: card.image }} />;
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
