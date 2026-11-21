// The combat damage step's turn-based action (CR 510.1–510.2). Which creatures deal damage in which step is
// first-strike.ts (CR 510.4); dividing a creature's damage is damage-assignment.ts.

import type { CardDatabase } from "../cards/types.ts";
import type { Progress } from "../game/progress.ts";
import { currentTurn } from "../game/turn.ts";
import { queueWork } from "../game/work.ts";
import { happenOrAsk } from "../pipeline/happen.ts";
import type { Damage } from "../pipeline/proposed.ts";
import { keywordsOf } from "../rules/abilities.ts";
import { attacksInCombat, isBlocked } from "../rules/combat.ts";
import { controllerOf } from "../rules/controller.ts";
import type { Attack, CombatDivision, DamageDivision } from "../state/combat.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import type { Target } from "../state/objects.ts";
import {
  askToAssign,
  attackersBlockedBy,
  blockersOf,
  blockingCreatures,
  combatPower,
  hasChoice,
  type Recipients,
  recipientsOf,
} from "./damage-assignment.ts";
import { assignsDamageNow } from "./first-strike.ts";

/**
 * Combat damage (CR 510.1): first the active player divides the damage of each attacker with a choice, one decision
 * each; then the defending player divides the damage of each blocker blocking two or more attackers (CR 510.1d). Then
 * all combat damage of this step is dealt at once (CR 510.2), and the active player gets priority (CR 510.3), after
 * state-based actions. `divisions` holds the divisions chosen so far; the ones with no choice are worked out again each
 * time, the same way.
 */
export function combatDamage(state: GameState, divisions: CombatDivision[], cards: CardDatabase): Progress {
  const attackers = settleAttackers(state, divisions, cards);
  if (attackers.ask !== null) {
    const { attacker, recipients, amount } = attackers.ask;
    return {
      state: askToAssign(state, controllerOf(state, attacker, cards), attacker, recipients, amount, divisions),
      events: [],
    };
  }
  for (const blocker of blockingCreatures(state, cards)) {
    const blocked = attackersBlockedBy(state, blocker, cards);
    const amount = combatPower(state, blocker, cards);
    if (!assignsDamageNow(state, blocker, cards) || divisionOf(blocker, divisions) !== undefined) continue;
    const recipients = { recipients: blocked.map((object): Target => ({ kind: "object", object })), lethal: null };
    if (!hasChoice(recipients, amount)) continue;
    return {
      state: askToAssign(state, controllerOf(state, blocker, cards), blocker, recipients, amount, divisions),
      events: [],
    };
  }
  const active = currentTurn(state).activePlayer;
  const damage = assignedDamage(state, attackers.divisions, divisions, cards);
  // Priority is queued first: the damage may wait for a choice between replacement effects (CR 616.1), and priority
  // must come after it either way.
  return happenOrAsk(queueWork(state, { kind: "givePriority", player: active }), { kind: "dealDamage", damage }, cards);
}

/**
 * The blocked attackers' divisions, in order: attackers without trample first, then tramplers, each one's division
 * known before the next is worked out, so a trampler's lethal damage counts what every earlier attacker assigns its
 * blockers (CR 702.19b). A division with no choice is filled in; the first attacker with a choice is returned to ask.
 * With two tramplers on one blocker, the first can't count damage from the second, so a split where both trample
 * over can't be chosen; the totals the player can be dealt are the same (later: CR 510.1e, checking the whole
 * assignment at once).
 */
function settleAttackers(
  state: GameState,
  chosen: readonly CombatDivision[],
  cards: CardDatabase,
): { divisions: CombatDivision[]; ask: { attacker: ObjectId; recipients: Recipients; amount: number } | null } {
  const divisions = [...chosen];
  for (const { attacker, defender } of attackersInOrder(state, cards)) {
    if (!assignsDamageNow(state, attacker, cards) || !isBlocked(state, attacker)) continue;
    if (divisionOf(attacker, divisions) !== undefined || blockersOf(state, attacker, cards).length === 0) continue;
    const amount = combatPower(state, attacker, cards);
    const recipients = recipientsOf(state, attacker, defender, amount, divisions, cards);
    if (hasChoice(recipients, amount)) return { divisions, ask: { attacker, recipients, amount } };
    const only = recipients.recipients[0];
    divisions.push({ source: attacker, division: only === undefined ? [] : [{ to: only, amount }] });
  }
  return { divisions, ask: null };
}

/** The attacks in combat, those without trample first, otherwise in the order declared. */
function attackersInOrder(state: GameState, cards: CardDatabase): Attack[] {
  const tramples = (a: { attacker: ObjectId }) => keywordsOf(state, a.attacker, cards).includes("trample");
  const attacks = attacksInCombat(state, cards);
  return [...attacks.filter((a) => !tramples(a)), ...attacks.filter(tramples)];
}

/**
 * Every combat damage assignment of this step (CR 510.1a–d), to be dealt at the same time: the attackers' from
 * `settleAttackers`, the blockers' as chosen or all to their one attacker.
 */
function assignedDamage(
  state: GameState,
  attackerDivisions: readonly CombatDivision[],
  chosen: readonly CombatDivision[],
  cards: CardDatabase,
): Damage[] {
  const damage: Damage[] = [];
  const deal = (source: ObjectId, division: DamageDivision) => {
    for (const part of division) {
      if (part.amount > 0) damage.push({ source, to: part.to, amount: part.amount, combat: true });
    }
  };
  for (const { attacker, defender } of attacksInCombat(state, cards)) {
    if (!assignsDamageNow(state, attacker, cards)) continue;
    const amount = combatPower(state, attacker, cards);
    const toDefender: DamageDivision = [{ to: { kind: "player", player: defender }, amount }];
    if (!isBlocked(state, attacker)) {
      // An unblocked creature assigns its damage to the player it attacks (CR 510.1b).
      deal(attacker, toDefender);
    } else if (blockersOf(state, attacker, cards).length === 0) {
      // A blocked creature with no blockers left assigns no damage (CR 510.1c), unless it has trample: then all of it
      // goes to the player, as though every blocker had lethal damage (CR 702.19d).
      if (keywordsOf(state, attacker, cards).includes("trample")) deal(attacker, toDefender);
    } else {
      deal(attacker, divisionOf(attacker, attackerDivisions) ?? []);
    }
  }
  // Each blocker assigns its damage to the attackers it blocks that are still in combat: as divided, or all to its one
  // attacker (CR 510.1d).
  for (const blocker of blockingCreatures(state, cards)) {
    if (!assignsDamageNow(state, blocker, cards)) continue;
    const amount = combatPower(state, blocker, cards);
    deal(blocker, divisionOf(blocker, chosen) ?? toFirst(attackersBlockedBy(state, blocker, cards), amount));
  }
  return damage;
}

function divisionOf(source: ObjectId, divisions: readonly CombatDivision[]): DamageDivision | undefined {
  return divisions.find((d) => d.source === source)?.division;
}

/** A division with no choice in it: all of the damage to the one creature it can go to. */
function toFirst(creatures: readonly ObjectId[], amount: number): DamageDivision {
  const first = creatures[0];
  return first === undefined ? [] : [{ to: { kind: "object", object: first }, amount }];
}
