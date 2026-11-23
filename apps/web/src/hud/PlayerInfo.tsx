// A player's info in a left corner (the owner, ui.md "Player info in the left corners"; D-164): their label and life
// total on one line, and under it the counts of their library (CR 401.3: anyone may count it), graveyard and exile
// (public zones, CR 400.2). Whose turn it is shows as a marker and the label in the accent, not colour alone; a player
// who can be targeted now makes the block a button with a dashed outline, and a tap picks them [R].

import type { Action, PlayerId, SeatView } from "@mtg/engine";
import type { Rect } from "../board-model/board-model.ts";
import type { Choice } from "../interaction/controls.ts";
import { place } from "./place.ts";

type Props = {
  shown: SeatView;
  player: PlayerId;
  rect: Rect;
  side: "mine" | "opponent";
  active: boolean;
  targets: Choice[];
  act: (action: Action) => void;
};

export function PlayerInfo({ shown, player, rect, side, active, targets, act }: Props) {
  const label = side === "mine" ? "You" : "Opponent";
  const counts = zoneCounts(shown, player);
  const life = shown.view.players[player]?.life ?? 0;
  const target = targets[0];
  const className = `player-info ${side}${active ? " active" : ""}${target !== undefined ? " target" : ""}`;
  const body = (
    <>
      <span className="player-line">
        {active && <span className="turn-marker" aria-hidden="true" />}
        <span className="player-name">{label}</span>
        <span className="player-life" role="img" aria-label={`${side === "mine" ? "Your" : "Opponent's"} life ${life}`}>
          {life}
        </span>
      </span>
      <span className="player-counts">
        <span>
          <b>{counts.library}</b> Library
        </span>
        <span>
          <b>{counts.graveyard}</b> Graveyard
        </span>
        <span>
          <b>{counts.exile}</b> Exile
        </span>
      </span>
    </>
  );
  if (target !== undefined) {
    return (
      <button
        type="button"
        className={className}
        style={place(rect)}
        aria-label={`${label}: ${target.label}`}
        onClick={() => act(target.action)}
      >
        {body}
      </button>
    );
  }
  return (
    <section className={className} style={place(rect)} aria-label={active ? `${label}, this turn` : label}>
      {body}
    </section>
  );
}

/** How many cards are in a player's library, graveyard and exile; exile counts the cards they own that can be seen. */
function zoneCounts(shown: SeatView, player: PlayerId): { library: number; graveyard: number; exile: number } {
  const zones = shown.view.zones;
  const own = zones.players[player];
  const exile = zones.exile.filter((id) => {
    const seen = shown.seen[id];
    return seen?.kind === "card" && seen.owner === player;
  }).length;
  return { library: own?.librarySize ?? 0, graveyard: own?.graveyard.length ?? 0, exile };
}
