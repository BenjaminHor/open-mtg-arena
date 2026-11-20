// Dividing a creature's combat damage among its recipients (CR 510.1c), and trample's rule that the player it attacks
// gets damage only once its blockers have lethal damage (CR 702.19b, 702.19d; over planeswalkers, later: CR 702.19c). One decision per creature with a choice; the
// player answers one recipient at a time, and the last recipient gets the rest, so a division always adds up (CR 510.1e).

import type { CardDatabase } from "../cards/types.ts";
import { waitFor } from "../game/decide.ts";
import { queueWork } from "../game/work.ts";
import { keywordsOf } from "../rules/abilities.ts";
import { blocksInCombat } from "../rules/combat.ts";
import { powerAndToughness } from "../rules/power-toughness.ts";
import type { CombatDivision } from "../state/combat.ts";
import type { PendingDecision } from "../state/decisions.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { Target } from "../state/objects.ts";

type AssignDamage = Extract<PendingDecision, { kind: "assignDamage" }>;

/**
 * Who a blocked attacker's damage can go to: the creatures blocking it, in the order they were declared, and with
 * trample, then the player it attacks (CR 702.19b). For a trampler, `lethal` is the damage each blocker needs before the
 * player can get any; null without trample.
 */
export function recipientsOf(
  state: GameState,
  attacker: ObjectId,
  defender: PlayerId,
  divisions: readonly CombatDivision[],
  cards: CardDatabase,
): { recipients: Target[]; lethal: number[] | null } {
  const blockers = blockersOf(state, attacker, cards);
  const creatures = blockers.map((object): Target => ({ kind: "object", object }));
  if (!keywordsOf(state, attacker, cards).includes("trample")) return { recipients: creatures, lethal: null };
  const lethal = blockers.map((blocker) => lethalDamage(state, blocker, attacker, divisions, cards));
  return { recipients: [...creatures, { kind: "player", player: defender }], lethal };
}

/** The blockers still blocking this attacker, in the order they were declared. */
export function blockersOf(state: GameState, attacker: ObjectId, cards: CardDatabase): ObjectId[] {
  return blocksInCombat(state, cards)
    .filter((b) => b.attacker === attacker)
    .map((b) => b.blocker);
}

/**
 * Lethal damage for a blocker, as trample counts it (CR 702.19b): its toughness less the damage already marked on it
 * and the damage other creatures have been assigned to it in this step, ignoring anything that would change the damage
 * actually dealt. From a source with deathtouch, any damage is lethal (CR 702.2c).
 */
function lethalDamage(
  state: GameState,
  blocker: ObjectId,
  source: ObjectId,
  divisions: readonly CombatDivision[],
  cards: CardDatabase,
): number {
  const obj = state.objects[blocker];
  const marked = obj?.kind === "card" ? obj.damage : 0;
  const assigned = divisions
    .flatMap((d) => d.division)
    .filter((part) => part.to.kind === "object" && part.to.object === blocker)
    .reduce((sum, part) => sum + part.amount, 0);
  const needed = Math.max(0, (powerAndToughness(state, blocker, cards).toughness ?? 0) - marked - assigned);
  return keywordsOf(state, source, cards).includes("deathtouch") ? Math.min(needed, 1) : needed;
}

/**
 * Whether the creature's controller has a choice to make: several recipients (CR 510.1c), or a trampler with one blocker
 * and more damage than that blocker needs (CR 702.19b). Otherwise all the damage goes to the first recipient.
 */
export function hasChoice(recipients: readonly Target[], lethal: readonly number[] | null, amount: number): boolean {
  if (amount === 0 || recipients.length < 2) return false;
  return lethal === null || recipients.length > 2 || amount > (lethal[0] ?? 0);
}

/** Asks the creature's controller to divide its damage. */
export function askToAssign(
  state: GameState,
  player: PlayerId,
  source: ObjectId,
  recipients: { recipients: Target[]; lethal: number[] | null },
  amount: number,
  divided: readonly CombatDivision[],
): GameState {
  return waitFor(state, player, {
    kind: "assignDamage",
    source,
    ...recipients,
    amount,
    assigned: [],
    divided: [...divided],
  });
}

/** What's left of the creature's damage after the amounts given so far. */
export function damageLeft(amount: number, assigned: readonly number[]): number {
  return amount - assigned.reduce((sum, n) => sum + n, 0);
}

/**
 * Why this amount can't go to the next recipient, or null: any whole amount from 0 up to what's left (CR 510.1c). For a
 * trampler, the answer for its last blocker decides whether the player gets the rest, which it may only if every blocker
 * has lethal damage (CR 702.19b); earlier blockers can get any amount, since the last can always take all that's left.
 */
export function assignProblem(pending: AssignDamage, amount: number): string | null {
  const left = damageLeft(pending.amount, pending.assigned);
  if (!Number.isInteger(amount) || amount < 0 || amount > left) return `give it a whole amount from 0 to ${left}`;
  const lethal = pending.lethal;
  const lastBlocker = pending.assigned.length === pending.recipients.length - 2;
  if (lethal === null || !lastBlocker || amount === left) return null;
  const short = [...pending.assigned, amount].some((n, i) => n < (lethal[i] ?? 0));
  return short
    ? `the player gets damage only once every blocker has lethal damage: give this one ${left} (CR 702.19b)`
    : null;
}

/**
 * The next recipient gets `amount`. Once only the last is left, it gets the rest and the creature's division is done;
 * combat damage then goes on (more decisions, or dealing it).
 */
export function assignToNextRecipient(state: GameState, pending: AssignDamage, amount: number): GameState {
  const assigned = [...pending.assigned, amount];
  if (assigned.length < pending.recipients.length - 1) {
    const { id: _id, player, ...decision } = pending;
    return waitFor(state, player, { ...decision, assigned });
  }
  const last = damageLeft(pending.amount, assigned);
  const division = pending.recipients.map((to, i) => ({ to, amount: assigned[i] ?? last }));
  const divisions = [...pending.divided, { source: pending.source, division }];
  return queueWork(state, { kind: "combatDamage", divisions });
}
