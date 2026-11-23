// "All Attack" (M3-04c; the owner asked for it, 2026-11-23): Arena's button that declares every creature that can
// attack [R]. The engine has no such action: each attacker is its own pick (CR 508.1a), checked as it's made. So the
// app sends the picks one at a time, each one of the options the engine lists after the last, until none is left.
// Pure, so it's tested without the app.

import type { Action, ObjectId, SeatView } from "@mtg/engine";

/**
 * The picks All Attack would still make: one per creature not yet attacking, at a player (a planeswalker is chosen on
 * the card), and none that would leave the declaration unable to finish (the seat view's `finishable`).
 */
function playerAttacks(shown: SeatView): Action[] {
  const decision = shown.view.decision;
  if (decision?.kind !== "declareAttackers") return [];
  const already = new Set<ObjectId>(decision.chosen.map((attack) => attack.attacker));
  const seen = new Set<ObjectId>();
  const picks: Action[] = [];
  for (const { action, finishable } of shown.options) {
    if (action.type !== "ANSWER" || action.answer.kind !== "declareAttacker" || finishable === false) continue;
    const attack = action.answer.attack;
    // At the player only: a planeswalker is a choice the person makes on the card (CR 508.1b).
    if (attack.attacked !== undefined || already.has(attack.attacker) || seen.has(attack.attacker)) continue;
    seen.add(attack.attacker);
    picks.push(action);
  }
  return picks;
}

/**
 * Whether All Attack is worth a button: two or more creatures could still attack (one is a single tap), and every pick
 * is at the same player. With more players to attack (later: multiplayer, CR 802), "all" says nothing about whom.
 */
export function allAttackOffered(shown: SeatView): boolean {
  const picks = playerAttacks(shown);
  const defenders = new Set(
    shown.options.flatMap(({ action }) =>
      action.type === "ANSWER" && action.answer.kind === "declareAttacker" ? [action.answer.attack.defender] : [],
    ),
  );
  return picks.length >= 2 && defenders.size === 1;
}

/** All Attack's next pick, or null when every creature that can attack a player is attacking. */
export function nextAllAttackPick(shown: SeatView): Action | null {
  return playerAttacks(shown)[0] ?? null;
}
