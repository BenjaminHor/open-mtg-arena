// The combat damage step's turn-based action (CR 510.1–510.2).

import type { CardDatabase } from "../cards/types.ts";
import { type Damage, dealDamage } from "../effects/deal-damage.ts";
import { waitFor } from "../game/decide.ts";
import { andThen, type Progress } from "../game/progress.ts";
import { currentTurn } from "../game/turn.ts";
import { queueWork } from "../game/work.ts";
import { attacksInCombat, blocksInCombat, isBlocked } from "../rules/combat.ts";
import { controllerOf } from "../rules/controller.ts";
import { powerAndToughness } from "../rules/power-toughness.ts";
import type { AttackerDivision } from "../state/combat.ts";
import type { PendingDecision } from "../state/decisions.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";

type Divisions = AttackerDivision[];

/**
 * Combat damage (CR 510.1): first each attacker blocked by two or more creatures has its damage divided by its
 * controller, one decision each (the active player's attackers are the only ones that can need it here); then all
 * combat damage is dealt at once (CR 510.2), and the active player gets priority (CR 510.3), after state-based actions.
 */
export function combatDamage(state: GameState, divisions: Divisions, cards: CardDatabase): Progress {
  for (const { attacker } of attacksInCombat(state, cards)) {
    const blockers = blockersOf(state, attacker, cards);
    const amount = combatPower(state, attacker, cards);
    if (blockers.length < 2 || amount === 0 || divisions.some((d) => d.attacker === attacker)) continue;
    const decision = { kind: "assignDamage" as const, attacker, blockers, amount, assigned: [], divided: divisions };
    return { state: waitFor(state, controllerOf(state, attacker), decision), events: [] };
  }
  const active = currentTurn(state).activePlayer;
  return andThen(dealDamage(state, assignedDamage(state, divisions, cards), cards), (s) => ({
    state: queueWork(s, { kind: "givePriority", player: active }),
    events: [],
  }));
}

/** Every combat damage assignment (CR 510.1a–d), to be dealt at the same time. */
function assignedDamage(state: GameState, divisions: Divisions, cards: CardDatabase): Damage[] {
  const damage: Damage[] = [];
  for (const { attacker, defender } of attacksInCombat(state, cards)) {
    const amount = combatPower(state, attacker, cards);
    if (amount === 0) continue;
    if (!isBlocked(state, attacker)) {
      // An unblocked creature assigns its damage to the player it attacks (CR 510.1b).
      damage.push({ source: attacker, to: { kind: "player", player: defender }, amount, combat: true });
      continue;
    }
    // A blocked creature with no blockers left assigns no damage; with one, all to it; with more, as divided (CR
    // 510.1c).
    const blockers = blockersOf(state, attacker, cards);
    const division =
      blockers.length === 1
        ? [{ blocker: blockers[0] as ObjectId, amount }]
        : (divisions.find((d) => d.attacker === attacker)?.division ?? []);
    for (const part of division) {
      damage.push({
        source: attacker,
        to: { kind: "object", object: part.blocker },
        amount: part.amount,
        combat: true,
      });
    }
  }
  // Each blocker assigns its damage to the attacker it blocks, if that's still in combat (CR 510.1d).
  for (const { blocker, attacker } of blocksInCombat(state, cards)) {
    const amount = combatPower(state, blocker, cards);
    if (amount > 0) damage.push({ source: blocker, to: { kind: "object", object: attacker }, amount, combat: true });
  }
  return damage;
}

/** The blockers still blocking this attacker, in the order they were declared. */
function blockersOf(state: GameState, attacker: ObjectId, cards: CardDatabase): ObjectId[] {
  return blocksInCombat(state, cards)
    .filter((b) => b.attacker === attacker)
    .map((b) => b.blocker);
}

/** The combat damage a creature assigns: its power, or none if that's 0 or less (CR 510.1a). */
function combatPower(state: GameState, id: ObjectId, cards: CardDatabase): number {
  return Math.max(0, powerAndToughness(state, id, cards).power ?? 0);
}

/**
 * Why this amount can't go to the next blocker, or null (CR 510.1c): any whole amount from 0 up to what's left, since
 * the division is free. The last blocker isn't asked: it gets the rest, so the division always adds up (CR 510.1e).
 */
export function assignProblem(left: number, amount: number): string | null {
  return Number.isInteger(amount) && amount >= 0 && amount <= left
    ? null
    : `give this blocker a whole amount from 0 to ${left}`;
}

/** What's left of the attacker's damage after the amounts given so far. */
export function damageLeft(amount: number, assigned: readonly number[]): number {
  return amount - assigned.reduce((sum, n) => sum + n, 0);
}

/**
 * The next blocker gets `amount`. Once only the last blocker is left, it gets the rest and the attacker's division is
 * done; combat damage then goes on (more decisions, or dealing it).
 */
export function assignToNextBlocker(
  state: GameState,
  pending: Extract<PendingDecision, { kind: "assignDamage" }>,
  amount: number,
): GameState {
  const assigned = [...pending.assigned, amount];
  if (assigned.length < pending.blockers.length - 1) {
    const { id: _id, player, ...decision } = pending;
    return waitFor(state, player, { ...decision, assigned });
  }
  const last = damageLeft(pending.amount, assigned);
  const division = pending.blockers.map((blocker, i) => ({ blocker, amount: assigned[i] ?? last }));
  const divisions = [...pending.divided, { attacker: pending.attacker, division }];
  return queueWork(state, { kind: "combatDamage", divisions });
}
