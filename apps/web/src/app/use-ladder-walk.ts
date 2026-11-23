// Walks the phase ladder through the phases a new view passed (D-175, `interaction/ladder-walk.ts`): each lit a
// moment, then the view's own step. Within a held frame the walk fits its hold, so it never runs into the next frame;
// at the person's decision it runs while they act, holding nothing up. At instant pace (tests) there's no walk.

import type { SeatView, ViewEvent } from "@mtg/engine";
import { useEffect, useState } from "react";
import { ladderWalk, type TurnPlace, WALK_MS } from "../interaction/ladder-walk.ts";
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
  // A new view starts its walk in the same render it's drawn in (React's state from props pattern), so the ladder never
  // shows the view's own step for a frame before walking back to the first phase passed.
  let current = walk;
  if (drawn !== walk.drawn) {
    const from = walk.drawn === null ? null : placeOf(walk.drawn);
    const places = pace === "instant" || drawn === null ? [] : ladderWalk(events, from, placeOf(drawn));
    current = { drawn, places, index: 0 };
    setWalk(current);
  }
  // Each phase a moment; in a held frame, the whole walk and its resting step share the hold.
  const ms = holdMs > 0 ? Math.min(WALK_MS, holdMs / (current.places.length + 1)) : WALK_MS;
  useEffect(() => {
    if (walk.index >= walk.places.length) return;
    const next = setTimeout(() => setWalk((w) => (w === walk ? { ...w, index: w.index + 1 } : w)), ms);
    return () => clearTimeout(next);
  }, [walk, ms]);
  return current.places[current.index] ?? null;
}

function placeOf(view: SeatView): TurnPlace | null {
  const turn = view.view.turn;
  return turn === null ? null : { step: turn.step, activePlayer: turn.activePlayer };
}
