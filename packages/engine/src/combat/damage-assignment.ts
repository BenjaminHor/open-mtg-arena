// Dividing a creature's combat damage among its recipients (CR 510.1c), and trample's rule that the player it attacks
// gets damage only once its blockers have lethal damage (CR 702.19b, 702.19d; over planeswalkers, later: CR 702.19c).
// One decision per creature with a choice: the player answers one recipient at a time, an answer that's the only legal
// one is filled in without asking, and the last recipient gets the rest, so a division always adds up (CR 510.1e).

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

/** Who a creature's damage can go to, and with trample, what each blocker needs before the player can get any. */
export type Recipients = { recipients: Target[]; lethal: number[] | null };

/**
 * Who a blocked attacker's damage can go to: the creatures blocking it, in the order they were declared, and with
 * trample, then the player or planeswalker it attacks (CR 702.19b), with `lethal` the damage each blocker needs first.
 * A trampler with no more damage than its blockers need together can't give the player any, so it divides among them
 * like any other creature; nor can one attacking a planeswalker that's gone, which attacks nothing (CR 702.19f).
 */
export function recipientsOf(
  state: GameState,
  attacker: ObjectId,
  attacked: Target | null,
  amount: number,
  divisions: readonly CombatDivision[],
  cards: CardDatabase,
): Recipients {
  const blockers = blockersOf(state, attacker, cards);
  const creatures = blockers.map((object): Target => ({ kind: "object", object }));
  if (!keywordsOf(state, attacker, cards).includes("trample")) return { recipients: creatures, lethal: null };
  const lethal = blockers.map((blocker) => lethalDamage(state, blocker, attacker, divisions, cards));
  if (attacked === null || amount <= lethal.reduce((sum, n) => sum + n, 0))
    return { recipients: creatures, lethal: null };
  return { recipients: [...creatures, attacked], lethal };
}

/** The blockers still blocking this attacker, in the order they were declared. */
export function blockersOf(state: GameState, attacker: ObjectId, cards: CardDatabase): ObjectId[] {
  return blocksInCombat(state, cards)
    .filter((b) => b.attacker === attacker)
    .map((b) => b.blocker);
}

/** The attackers still in combat this creature blocks, in the order the blocks were declared. */
export function attackersBlockedBy(state: GameState, blocker: ObjectId, cards: CardDatabase): ObjectId[] {
  return blocksInCombat(state, cards)
    .filter((b) => b.blocker === blocker)
    .map((b) => b.attacker);
}

/** The creatures blocking an attacker still in combat, each once, in the order their first block was declared. */
export function blockingCreatures(state: GameState, cards: CardDatabase): ObjectId[] {
  const blockers = blocksInCombat(state, cards).map((b) => b.blocker);
  return blockers.filter((b, i) => blockers.indexOf(b) === i);
}

/** The combat damage a creature assigns: its power, or none if that's 0 or less (CR 510.1a). */
export function combatPower(state: GameState, id: ObjectId, cards: CardDatabase): number {
  return Math.max(0, powerAndToughness(state, id, cards).power ?? 0);
}

/**
 * Lethal damage for a blocker, as trample counts it (CR 702.19b): its toughness less the damage already marked on it
 * and the damage other attackers are assigned to it in this step, ignoring anything that would change the damage
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
  const others = otherDamageTo(state, blocker, source, divisions, cards);
  const needed = Math.max(0, (powerAndToughness(state, blocker, cards).toughness ?? 0) - marked - others);
  return keywordsOf(state, source, cards).includes("deathtouch") ? Math.min(needed, 1) : needed;
}

/**
 * The damage other attackers assign this blocker in this step (it blocks several: Palace Guard), from the divisions
 * known so far (chosen, or with no choice: `settleAttackers` works them out in order). Any from a source with
 * deathtouch counts as lethal (CR 702.2c), so the blocker then needs nothing more: `Infinity`.
 */
function otherDamageTo(
  state: GameState,
  blocker: ObjectId,
  source: ObjectId,
  divisions: readonly CombatDivision[],
  cards: CardDatabase,
): number {
  let total = 0;
  for (const { source: other, division } of divisions) {
    if (other === source) continue;
    const amount = division
      .filter((p) => p.to.kind === "object" && p.to.object === blocker)
      .reduce((sum, p) => sum + p.amount, 0);
    if (amount > 0 && keywordsOf(state, other, cards).includes("deathtouch")) return Number.POSITIVE_INFINITY;
    total += amount;
  }
  return total;
}

/**
 * Whether the creature's controller has a choice to make: several recipients (CR 510.1c), or a trampler with one blocker
 * and more damage than that blocker needs (CR 702.19b; `recipientsOf` adds the player only then). Otherwise all the
 * damage goes to the first recipient.
 */
export function hasChoice({ recipients }: Recipients, amount: number): boolean {
  return amount > 0 && recipients.length >= 2;
}

/** Asks the creature's controller to divide its damage. */
export function askToAssign(
  state: GameState,
  player: PlayerId,
  source: ObjectId,
  { recipients, lethal }: Recipients,
  amount: number,
  divided: readonly CombatDivision[],
): GameState {
  return waitFor(state, player, {
    kind: "assignDamage",
    source,
    recipients,
    lethal,
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
    ? `the player or planeswalker attacked gets damage only once every blocker has lethal damage: give this one ${left} (CR 702.19b)`
    : null;
}

/** Every amount the next recipient may be given. */
export function legalAmounts(pending: AssignDamage): number[] {
  const left = damageLeft(pending.amount, pending.assigned);
  return Array.from({ length: left + 1 }, (_, amount) => amount).filter((n) => assignProblem(pending, n) === null);
}

/**
 * The amounts given so far, with every following answer that has only one legal amount filled in: a trampler whose
 * earlier blocker got less than lethal must give its last blocker all that's left (CR 702.19b), so it isn't asked.
 */
export function withForcedAnswers(pending: AssignDamage, assigned: readonly number[]): number[] {
  const filled = [...assigned];
  while (filled.length < pending.recipients.length - 1) {
    const only = legalAmounts({ ...pending, assigned: filled });
    if (only.length !== 1) break;
    filled.push(only[0] as number);
  }
  return filled;
}

/**
 * The next recipient gets `amount`, and forced answers after it are filled in. Once only the last recipient is left, it
 * gets the rest and the creature's division is done; combat damage then goes on (more decisions, or dealing it).
 */
export function assignToNextRecipient(state: GameState, pending: AssignDamage, amount: number): GameState {
  const assigned = withForcedAnswers(pending, [...pending.assigned, amount]);
  if (assigned.length < pending.recipients.length - 1) {
    const { id: _id, player, ...decision } = pending;
    return waitFor(state, player, { ...decision, assigned });
  }
  const last = damageLeft(pending.amount, assigned);
  const division = pending.recipients.map((to, i) => ({ to, amount: assigned[i] ?? last }));
  const divisions = [...pending.divided, { source: pending.source, division }];
  return queueWork(state, { kind: "combatDamage", divisions });
}
