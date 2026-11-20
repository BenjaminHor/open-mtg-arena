// The combat damage step's turn-based action (CR 510.1–510.2). Which creatures deal damage in which step is
// first-strike.ts (CR 510.4); dividing a creature's damage is damage-assignment.ts.

import type { CardDatabase } from "../cards/types.ts";
import { andThen, type Progress } from "../game/progress.ts";
import { currentTurn } from "../game/turn.ts";
import { queueWork } from "../game/work.ts";
import { happen } from "../pipeline/happen.ts";
import type { Damage } from "../pipeline/proposed.ts";
import { keywordsOf } from "../rules/abilities.ts";
import { attacksInCombat, isBlocked } from "../rules/combat.ts";
import { controllerOf } from "../rules/controller.ts";
import type { CombatDivision, DamageDivision } from "../state/combat.ts";
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
  recipientsOf,
} from "./damage-assignment.ts";
import { assignsDamageNow } from "./first-strike.ts";

/**
 * Combat damage (CR 510.1): first the active player divides the damage of each attacker with a choice, one decision
 * each, attackers without trample first so a trampler's lethal damage can count theirs (CR 702.19b); then the defending
 * player divides the damage of each blocker blocking two or more attackers (CR 510.1d). Then all combat damage of this
 * step is dealt at once (CR 510.2), and the active player gets priority (CR 510.3), after state-based actions.
 */
export function combatDamage(state: GameState, divisions: CombatDivision[], cards: CardDatabase): Progress {
  const undivided = (id: ObjectId) => assignsDamageNow(state, id, cards) && !divisions.some((d) => d.source === id);
  for (const { attacker, defender } of attackersInOrder(state, cards)) {
    if (!undivided(attacker) || !isBlocked(state, attacker)) continue;
    const amount = combatPower(state, attacker, cards);
    const recipients = recipientsOf(state, attacker, defender, amount, divisions, cards);
    if (!hasChoice(recipients, amount)) continue;
    return {
      state: askToAssign(state, controllerOf(state, attacker), attacker, recipients, amount, divisions),
      events: [],
    };
  }
  for (const blocker of blockingCreatures(state, cards)) {
    const attackers = attackersBlockedBy(state, blocker, cards);
    const amount = combatPower(state, blocker, cards);
    if (!undivided(blocker) || attackers.length < 2 || amount === 0) continue;
    const recipients = { recipients: attackers.map((object): Target => ({ kind: "object", object })), lethal: null };
    return {
      state: askToAssign(state, controllerOf(state, blocker), blocker, recipients, amount, divisions),
      events: [],
    };
  }
  const active = currentTurn(state).activePlayer;
  const damage = assignedDamage(state, divisions, cards);
  return andThen(happen(state, { kind: "dealDamage", damage }, cards), (s) => ({
    state: queueWork(s, { kind: "givePriority", player: active }),
    events: [],
  }));
}

/** The attacks in combat, those without trample first, otherwise in the order declared. */
function attackersInOrder(state: GameState, cards: CardDatabase) {
  const tramples = (a: { attacker: ObjectId }) => keywordsOf(state, a.attacker, cards).includes("trample");
  const attacks = attacksInCombat(state, cards);
  return [...attacks.filter((a) => !tramples(a)), ...attacks.filter(tramples)];
}

/** Every combat damage assignment of this step (CR 510.1a–d), to be dealt at the same time. */
function assignedDamage(state: GameState, divisions: readonly CombatDivision[], cards: CardDatabase): Damage[] {
  const damage: Damage[] = [];
  const deal = (source: ObjectId, division: DamageDivision) => {
    for (const part of division)
      if (part.amount > 0) damage.push({ source, to: part.to, amount: part.amount, combat: true });
  };
  for (const { attacker, defender } of attacksInCombat(state, cards)) {
    if (!assignsDamageNow(state, attacker, cards)) continue;
    const amount = combatPower(state, attacker, cards);
    const toDefender: DamageDivision = [{ to: { kind: "player", player: defender }, amount }];
    // An unblocked creature assigns its damage to the player it attacks (CR 510.1b).
    if (!isBlocked(state, attacker)) deal(attacker, toDefender);
    // A blocked creature with no blockers left assigns no damage (CR 510.1c), unless it has trample: then all of it goes
    // to the player, as though every blocker had lethal damage (CR 702.19d).
    else if (blockersOf(state, attacker, cards).length === 0) {
      if (keywordsOf(state, attacker, cards).includes("trample")) deal(attacker, toDefender);
    }
    // As divided, or with no choice, all to its one blocker (CR 510.1c).
    else deal(attacker, divisionOf(attacker, divisions) ?? toFirst(blockersOf(state, attacker, cards), amount));
  }
  // Each blocker assigns its damage to the attackers it blocks that are still in combat: as divided, or all to its one
  // attacker (CR 510.1d).
  for (const blocker of blockingCreatures(state, cards)) {
    if (!assignsDamageNow(state, blocker, cards)) continue;
    const amount = combatPower(state, blocker, cards);
    deal(blocker, divisionOf(blocker, divisions) ?? toFirst(attackersBlockedBy(state, blocker, cards), amount));
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
