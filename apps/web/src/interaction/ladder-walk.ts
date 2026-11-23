// The phase ladder walks (D-175; the owner: Arena's "steps through each phase as it passes - we should avoid immediate
// jumps between the "main" phases"): when the game moves on several steps at once (a frame of the opponent's turn, the
// person passing from main 1 to main 2 with no attack), the lit rung moves through each phase passed, a moment on each,
// before resting where the game is. Pure: the steps come from the STEP_BEGAN events that led to the view (CR 500.1's
// order, as the engine played it, extra turns and skipped steps included).

import { phaseOf, type ViewEvent } from "@mtg/engine";
import type { LadderPlace } from "../board-model/ladder.ts";

/** A place in the game the ladder can light: a step, whose turn, and which turn. */
export type TurnPlace = LadderPlace & { turn: number };

/** ms per phase lit on the way: quick enough that the walk never holds anything up [guess, to tune with the owner]. */
export const WALK_MS = 140;

/**
 * The places the ladder lights on its way from `from` (lit now) to `to` (where the game rests): first `pending` (the
 * rest of a walk a new view cut short), then the steps these events began. One per phase passed (untap, upkeep and draw
 * all light "Beginning" once), neither the phase it starts in nor the one it rests in. Only the turn the view shows is
 * walked: its banner, its player's turn marker and its controls already say whose turn it is, and the ladder never
 * says otherwise; the turn's change is marked by its banner.
 */
export function ladderWalk(
  events: readonly ViewEvent[],
  from: TurnPlace | null,
  to: TurnPlace | null,
  pending: readonly TurnPlace[] = [],
): TurnPlace[] {
  if (from === null || to === null) return [];
  const began = events.flatMap((e) =>
    e.type === "STEP_BEGAN" ? [{ turn: e.turn, step: e.step, activePlayer: e.activePlayer }] : [],
  );
  const walk: TurnPlace[] = [];
  let last = from;
  for (const place of [...pending, ...began]) {
    if (place.turn !== to.turn || samePhase(place, last)) continue;
    walk.push(place);
    last = place;
  }
  // The walk ends where the game rests: that phase is lit by the view itself.
  while (walk.length > 0 && samePhase(walk.at(-1) ?? to, to)) walk.pop();
  return walk;
}

/** How long each phase of a walk is lit: in a held frame, the walk and its resting step share the frame's hold. */
export function walkStepMs(holdMs: number, places: number): number {
  return holdMs > 0 ? Math.min(WALK_MS, holdMs / (places + 1)) : WALK_MS;
}

function samePhase(a: TurnPlace, b: TurnPlace): boolean {
  return a.turn === b.turn && phaseOf(a.step) === phaseOf(b.step);
}
