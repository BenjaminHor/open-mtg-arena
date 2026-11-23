// Walks the phase ladder through the phases a new view passed (D-175, `interaction/ladder-walk.ts`): each lit a
// moment, then the view's own step. Within a held frame the walk fits its hold, so it never runs into the next frame;
// at the person's decision it runs while they act, holding nothing up. A view arriving mid-walk carries on from the
// phase lit then, through what was left. At instant pace (tests) there's no walk.

import type { SeatView, ViewEvent } from "@mtg/engine";
import { useEffect, useState } from "react";
import { ladderWalk, type TurnPlace, walkStepMs } from "../interaction/ladder-walk.ts";
import type { Pace } from "./use-playback.ts";

type Walk = { drawn: SeatView | null; places: TurnPlace[]; index: number };

/** Where the ladder lights now while it walks; null when it shows the drawn view's own step. */
export function useLadderWalk(
  drawn: SeatView | null,
  events: readonly ViewEvent[],
  holdMs: number,
  pace: Pace,
): TurnPlace | null {
  const [walk, setWalk] = useState<Walk>({ drawn: null, places: [], index: 0 });
  // A new view starts its walk in the same render it's drawn in (React's state-from-props pattern), so the ladder never
  // shows the view's own step for a frame before walking back to the first phase passed.
  let current = walk;
  if (drawn !== walk.drawn) {
    const rest = walk.drawn === null ? null : placeOf(walk.drawn);
    const lit = walk.places[walk.index] ?? rest;
    // Cut short: what it hadn't reached yet, then the old view's own phase, come first.
    const pending =
      walk.index < walk.places.length && rest !== null ? [...walk.places.slice(walk.index + 1), rest] : [];
    const places = pace === "instant" || drawn === null ? [] : ladderWalk(events, lit, placeOf(drawn), pending);
    current = { drawn, places, index: 0 };
    setWalk(current);
  }
  const ms = walkStepMs(holdMs, current.places.length);
  useEffect(() => {
    if (walk.index >= walk.places.length) return;
    const next = setTimeout(() => setWalk((w) => (w === walk ? { ...w, index: w.index + 1 } : w)), ms);
    return () => clearTimeout(next);
  }, [walk, ms]);
  return current.places[current.index] ?? null;
}

function placeOf(view: SeatView): TurnPlace | null {
  const turn = view.view.turn;
  return turn === null ? null : { turn: turn.number, step: turn.step, activePlayer: turn.activePlayer };
}
