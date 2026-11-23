// Shaping a declaration of attackers by more than one pick at a time (M3-04c; the owner asked for "All Attack",
// 2026-11-23): All Attack [R], Clear Attacks, and taking one creature out of the attack. The engine has none of these:
// each attacker is its own pick (CR 508.1a), checked as it's made, and its "take back" undoes only the last one. So the
// app sets a goal (the attackers wanted) and moves toward it one engine option at a time, a pick or a take-back per
// reply: `stepToward`. Pure, so it's tested without the app (D-158).

import type { Action, ObjectId, SeatView } from "@mtg/engine";

/** An attacker wanted in the declaration, and whom it attacks: a player, or a planeswalker (`attacked`). */
export type WantedAttack = { attacker: ObjectId; attacked?: ObjectId };

type Attack = { attacker: ObjectId; attacked?: ObjectId };

const same = (a: Attack, b: WantedAttack) => a.attacker === b.attacker && a.attacked === b.attacked;

function declared(shown: SeatView): Attack[] | null {
  const decision = shown.view.decision;
  return decision?.kind === "declareAttackers" ? (decision.chosen as Attack[]) : null;
}

/**
 * The picks All Attack would add: one per creature not yet attacking, at a player (a planeswalker is chosen on the
 * card), and none that would leave the declaration unable to finish (the seat view's `finishable`).
 */
function playerPicks(shown: SeatView): Action[] {
  const chosen = declared(shown);
  if (chosen === null) return [];
  const already = new Set<ObjectId>(chosen.map((attack) => attack.attacker));
  const picks: Action[] = [];
  for (const { action, finishable } of shown.options) {
    if (action.type !== "ANSWER" || action.answer.kind !== "declareAttacker" || finishable === false) continue;
    const attack = action.answer.attack;
    // At a player only: a planeswalker is a choice the person makes on the card (CR 508.1b).
    if (attack.attacked !== undefined || already.has(attack.attacker)) continue;
    already.add(attack.attacker);
    picks.push(action);
  }
  return picks;
}

/**
 * Whether All Attack is worth a button: two or more creatures could still attack (one is a single tap), and every pick
 * is at the same player. With more players to attack (later: multiplayer, CR 802), "all" says nothing about whom.
 */
export function allAttackOffered(shown: SeatView): boolean {
  const defenders = new Set(
    shown.options.flatMap(({ action }) =>
      action.type === "ANSWER" && action.answer.kind === "declareAttacker" ? [action.answer.attack.defender] : [],
    ),
  );
  return playerPicks(shown).length >= 2 && defenders.size === 1;
}

/** All Attack's goal: every creature attacking now, and every one that can attack a player. */
export function allAttackGoal(shown: SeatView): WantedAttack[] {
  const now = declared(shown) ?? [];
  const more = playerPicks(shown).flatMap((a) =>
    a.type === "ANSWER" && a.answer.kind === "declareAttacker" ? [{ attacker: a.answer.attack.attacker }] : [],
  );
  return [...now, ...more];
}

/** The goal with one creature taken out of the attack: every other attacker as it is. */
export function withoutAttacker(shown: SeatView, id: ObjectId): WantedAttack[] {
  return (declared(shown) ?? []).filter((attack) => attack.attacker !== id);
}

/**
 * The next action toward the goal, or null when the declaration is there (or can't get closer). While the declaration
 * holds an attacker the goal doesn't want, take back the last pick (the engine's only way to undo: last first); the
 * ones taken back that the goal keeps are picked again after. Then pick, in order, each wanted attacker not yet in.
 */
export function stepToward(shown: SeatView, goal: readonly WantedAttack[]): Action | null {
  const chosen = declared(shown);
  if (chosen === null) return null;
  const unwanted = chosen.some((attack) => !goal.some((wanted) => same(attack, wanted)));
  if (unwanted) {
    const takeBack = shown.options.find((o) => o.action.type === "ANSWER" && o.action.answer.kind === "takeBack");
    return takeBack?.action ?? null;
  }
  for (const wanted of goal) {
    if (chosen.some((attack) => same(attack, wanted))) continue;
    const pick = shown.options.find(
      (o) =>
        o.action.type === "ANSWER" &&
        o.action.answer.kind === "declareAttacker" &&
        same(o.action.answer.attack, wanted),
    );
    // A wanted attacker the engine no longer offers (it can't attack now) is skipped, not waited for.
    if (pick !== undefined) return pick.action;
  }
  return null;
}
