// A player's info in a left corner (the owner, ui.md "Player info in the left corners"; D-164): their label and life
// total on one line, and under it the counts of their library (CR 401.3: anyone may count it), graveyard and exile
// (public zones, CR 400.2). Whose turn it is shows as a marker and the label in the accent, not colour alone; a player
// who can be targeted now has a dashed outline, and a tap picks them [R]. Otherwise a tap opens their zones in the
// browser [R: "tapping a zone opens a browser"]; a long-press, right-click or "i" always does, target or not.
// What of theirs is revealed shows beside it at a glance (`RevealedMarks`).

import type { Action, PlayerId, SeatView } from "@mtg/engine";
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
        aria-label={target !== undefined ? `${label}: ${target.label}` : `${name}: graveyard and exile`}
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
      <RevealedMarks shown={shown} player={player} rect={rect} side={side} browse={browse} />
    </>
  );
}

/** px: the marks' row, beside the block (below the opponent's, above the person's, clear of the mana pool chip). */
const MARKS = { height: 56, gap: 6, pool: 32 };

/**
 * What of a player's is revealed to everyone, at a glance [U: "revealed cards are shown face up"]: their library's top
 * card as a small face-up tile (Vampire Nocturnus, CR 401.5), where Arena keeps a library pile, and an eye marking a
 * revealed hand (Telepathy, CR 701.20a). A tap on either opens the browser there; the person's own hand is in front of
 * them, so its mark is only a note.
 */
function RevealedMarks({ shown, player, rect, side, browse }: Omit<Props, "active" | "targets" | "act">) {
  const zones = playerZones(shown, player);
  if (zones.revealedTop === null && !zones.handRevealed) return null;
  const whose = side === "mine" ? "Your" : "Opponent's";
  const y = side === "opponent" ? rect.y + rect.height + MARKS.gap : rect.y - MARKS.pool - MARKS.gap - MARKS.height;
  const top = zones.revealedTop;
  return (
    <div className={`revealed-marks ${side}`} style={{ left: rect.x, top: y, height: MARKS.height }}>
      {top !== null && (
        <button
          type="button"
          className="revealed-top"
          aria-label={`${whose} library top: ${top.name}`}
          onClick={() => browse("library")}
        >
          {top.art !== null && <img src={top.art} alt="" draggable={false} />}
          <span>{top.name}</span>
        </button>
      )}
      {zones.handRevealed &&
        (side === "opponent" ? (
          <button type="button" className="revealed-hand" onClick={() => browse("hand")}>
            <Eye />
            Hand revealed
          </button>
        ) : (
          <span className="revealed-hand">
            <Eye />
            Hand revealed
          </span>
        ))}
    </div>
  );
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
