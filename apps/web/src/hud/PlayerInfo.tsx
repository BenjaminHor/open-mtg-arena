// A player's info in a left corner (the owner, ui.md "Player info in the left corners"; D-164): their label and life
// total on one line, and under it the counts of their library (CR 401.3: anyone may count it), graveyard and exile
// (public zones, CR 400.2). Whose turn it is shows as a marker and the label in the accent, not colour alone; a player
// who can be targeted now has a dashed outline, and a tap picks them [R]. Otherwise a tap opens their zones in the
// browser [R: "tapping a zone opens a browser"]; a long-press, right-click or "i" always does, target or not.
// What of theirs is revealed shows beside it at a glance (`RevealedMarks`).

import type { Action, PlayerId, SeatView } from "@mtg/engine";
import { useState } from "react";
import type { Rect } from "../board-model/board-model.ts";
import type { Choice } from "../interaction/controls.ts";
import { playerZones, type ZoneName } from "../interaction/zones.ts";
import { useLook } from "./long-press.ts";
import { place } from "./place.ts";

type Props = {
  shown: SeatView;
  player: PlayerId;
  rect: Rect;
  side: "mine" | "opponent";
  active: boolean;
  targets: Choice[];
  act: (action: Action) => void;
  browse: (zone: ZoneName) => void;
};

export function PlayerInfo({ shown, player, rect, side, active, targets, act, browse }: Props) {
  const label = side === "mine" ? "You" : "Opponent";
  const zones = playerZones(shown, player);
  const life = shown.view.players[player]?.life ?? 0;
  const target = targets[0];
  const look = useLook(() => browse("graveyard"));
  const className = `player-info ${side}${active ? " active" : ""}${target !== undefined ? " target" : ""}`;
  const name = `${label}${active ? ", this turn" : ""}`;
  return (
    <>
      <button
        type="button"
        className={className}
        style={place(rect)}
        // The label is all a screen reader says of a button, so it carries the life and counts too.
        aria-label={`${target !== undefined ? `${label}: ${target.label}` : `${name}: graveyard and exile`} (life ${life}; ${zones.library} library, ${zones.graveyard} graveyard, ${zones.exile} exile)`}
        onClick={() => (target !== undefined ? act(target.action) : browse("graveyard"))}
        {...look}
      >
        <span className="player-line">
          {active && <span className="turn-marker" aria-hidden="true" />}
          <span className="player-name">{label}</span>
          <span
            className="player-life"
            role="img"
            aria-label={`${side === "mine" ? "Your" : "Opponent's"} life ${life}`}
          >
            {life}
          </span>
        </span>
        <span className="player-counts">
          <span>
            <b>{zones.library}</b> Library
          </span>
          <span>
            <b>{zones.graveyard}</b> Graveyard
          </span>
          <span>
            <b>{zones.exile}</b> Exile
          </span>
        </span>
      </button>
      <RevealedMarks
        shown={shown}
        player={player}
        rect={rect}
        side={side}
        browse={browse}
        inert={target !== undefined}
      />
    </>
  );
}

/**
 * px: the marks' column, beside the block (below the opponent's, above the person's, clear of the mana pool chip),
 * within the block's width so it never reaches the board's rows. The gap keeps a slightly low tap on a targeted player
 * off them.
 */
const MARKS = { tile: 56, chip: 28, between: 6, gap: 12, pool: 32 };

/**
 * What of a player's is revealed to everyone, at a glance [U: "revealed cards are shown face up"]: their library's top
 * card as a small face-up tile on a pile's edge (Vampire Nocturnus, CR 401.5), where Arena keeps a library pile, and an
 * eye marking a revealed hand (Telepathy, CR 701.20a). A tap on either opens the browser there; the person's own hand
 * is in front of them, so its mark is only a note. While a player is a target they step aside (no taps), so a tap near
 * the block is never taken for another.
 */
function RevealedMarks({
  shown,
  player,
  rect,
  side,
  browse,
  inert,
}: Omit<Props, "active" | "targets" | "act"> & {
  inert: boolean;
}) {
  const zones = playerZones(shown, player);
  const top = zones.revealedTop;
  if (top === null && !zones.handRevealed) return null;
  const whose = side === "mine" ? "Your" : "Opponent's";
  const height =
    (top === null ? 0 : MARKS.tile) +
    (zones.handRevealed ? MARKS.chip : 0) +
    (top !== null && zones.handRevealed ? MARKS.between : 0);
  const y = side === "opponent" ? rect.y + rect.height + MARKS.gap : rect.y - MARKS.pool - MARKS.gap - height;
  return (
    <div
      className={`revealed-marks ${side}${inert ? " inert" : ""}`}
      style={{ left: rect.x, top: y, width: rect.width, height }}
    >
      {top !== null && (
        <button
          type="button"
          className="revealed-top"
          aria-label={`${whose} library top: ${top.name}`}
          tabIndex={inert ? -1 : undefined}
          onClick={() => browse("library")}
        >
          <TopArt url={top.art} />
          <span>
            <small>Library top</small>
            {top.name}
          </span>
        </button>
      )}
      {zones.handRevealed &&
        (side === "opponent" ? (
          <button
            type="button"
            className="revealed-hand"
            aria-label="Opponent's hand revealed"
            tabIndex={inert ? -1 : undefined}
            onClick={() => browse("hand")}
          >
            <Eye />
            Hand revealed
          </button>
        ) : (
          <span className="revealed-hand note">
            <Eye />
            Your hand is revealed
          </span>
        ))}
    </div>
  );
}

/** The top card's art; with none (offline, or it failed), the tile's plain colour and the name on it. */
function TopArt({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (url === null || failed) return null;
  return <img src={url} alt="" draggable={false} onError={() => setFailed(true)} />;
}

/** An open eye, our own shape (D-140): this is shown to everyone. */
function Eye() {
  return (
    <svg viewBox="0 0 16 10" width="16" height="10" aria-hidden="true">
      <path d="M1 5 Q8 -2 15 5 Q8 12 1 5 Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="5" r="2" fill="currentColor" />
    </svg>
  );
}
