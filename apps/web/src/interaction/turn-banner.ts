// The banner a new turn gets (the owner, 2026-11-23: "sometimes I get to play two lands on one turn"): the host passes
// for the person where they have nothing to do (D-143, D-157), so one press of the main button can run through the
// opponent's whole turn and stop in the person's next main phase. Without a sign, that new turn's land drop looks like
// a second one in the same turn. Arena shows a turn's start [R]; so does this: "Turn 6 · Your turn".

import type { SeatView } from "@mtg/engine";

/** What the banner says when the turn has changed since the last view (`before`), or null when it hasn't. */
export function turnBanner(before: number | null, shown: SeatView): string | null {
  const turn = shown.view.turn;
  if (turn === null || shown.view.result !== null || turn.number === before) return null;
  return `Turn ${turn.number} · ${turn.activePlayer === shown.player ? "Your turn" : "Opponent's turn"}`;
}
