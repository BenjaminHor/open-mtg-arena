// The phase ladder walks (D-175; the owner: Arena's "steps through each phase as it passes - we should avoid immediate
// jumps between the "main" phases"): when the game moves on several steps at once (a frame of the opponent's turn, the
// person passing from main 1 to main 2 with no attack), the lit rung moves through each phase passed, a moment on each,
// before resting where the game is. Pure: the steps come from the frame's STEP_BEGAN events (CR 500.1's order, as the
// engine played it, extra turns and skipped steps included).

import type { PlayerId, Step, ViewEvent } from "@mtg/engine";
import { phaseRung } from "../board-model/ladder.ts";

/** A place in the turn the ladder can light: a step, and whose turn it is (which ladder lights it). */
export type TurnPlace = { step: Step; activePlayer: PlayerId };

/** ms per rung lit on the way: quick enough that the walk never holds anything up [guess, to tune with the owner]. */
export const WALK_MS = 140;

/**
 * The places the ladder lights on its way from `from` to where these events leave the game (`to`), one per phase
 * passed: neither the phase it starts in nor the one it rests in, and each phase once though several of its steps
 * passed (untap, upkeep and draw all light "Beginning").
 */
export function ladderWalk(events: readonly ViewEvent[], from: TurnPlace | null, to: TurnPlace | null): TurnPlace[] {
  if (from === null || to === null) return [];
  const walk: TurnPlace[] = [];
  let last = from;
  for (const e of events) {
    if (e.type !== "STEP_BEGAN") continue;
    const place = { step: e.step, activePlayer: e.activePlayer };
    if (samePhase(place, last)) continue;
    walk.push(place);
    last = place;
  }
  // The walk ends where the game rests: that phase is lit by the view itself.
  while (walk.length > 0 && samePhase(walk[walk.length - 1] as TurnPlace, to)) walk.pop();
  return walk;
}

function samePhase(a: TurnPlace, b: TurnPlace): boolean {
  return a.activePlayer === b.activePlayer && phaseRung(a.step) === phaseRung(b.step);
}
