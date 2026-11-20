// The combat damage step's turn-based action (CR 510.1–510.2). Which creatures deal damage in which step is
// first-strike.ts (CR 510.4); dividing a creature's damage is damage-assignment.ts.

import type { CardDatabase } from "../cards/types.ts";
import { andThen, type Progress } from "../game/progress.ts";
import { currentTurn } from "../game/turn.ts";
import { queueWork } from "../game/work.ts";
import { happen } from "../pipeline/happen.ts";
import type { Damage } from "../pipeline/proposed.ts";
import { keywordsOf } from "../rules/abilities.ts";
import { attacksInCombat, blocksInCombat, isBlocked } from "../rules/combat.ts";
import { controllerOf } from "../rules/controller.ts";
import { powerAndToughness } from "../rules/power-toughness.ts";
import type { CombatDivision } from "../state/combat.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import { askToAssign, blockersOf, hasChoice, recipientsOf } from "./damage-assignment.ts";
import { assignsDamageNow } from "./first-strike.ts";

/**
 * Combat damage (CR 510.1): first each attacker with a choice of how to divide its damage has it divided by its
 * controller, one decision each (the active player's attackers are the only ones that can need it here); then all
 * combat damage of this step is dealt at once (CR 510.2), and the active player gets priority (CR 510.3), after
 * state-based actions.
 */
export function combatDamage(state: GameState, divisions: CombatDivision[], cards: CardDatabase): Progress {
  for (const { attacker, defender } of attacksInCombat(state, cards)) {
    if (!assignsDamageNow(state, attacker, cards) || !isBlocked(state, attacker)) continue;
    if (divisions.some((d) => d.source === attacker)) continue;
    const recipients = recipientsOf(state, attacker, defender, divisions, cards);
    const amount = combatPower(state, attacker, cards);
    if (!hasChoice(recipients.recipients, recipients.lethal, amount)) continue;
    const asked = askToAssign(state, controllerOf(state, attacker), attacker, recipients, amount, divisions);
    return { state: asked, events: [] };
  }
  const active = currentTurn(state).activePlayer;
  const damage = assignedDamage(state, divisions, cards);
  return andThen(happen(state, { kind: "dealDamage", damage }, cards), (s) => ({
    state: queueWork(s, { kind: "givePriority", player: active }),
    events: [],
  }));
}

/** Every combat damage assignment of this step (CR 510.1a–d), to be dealt at the same time. */
function assignedDamage(state: GameState, divisions: readonly CombatDivision[], cards: CardDatabase): Damage[] {
  const damage: Damage[] = [];
  for (const { attacker, defender } of attacksInCombat(state, cards)) {
    if (!assignsDamageNow(state, attacker, cards)) continue;
    const amount = combatPower(state, attacker, cards);
    if (amount === 0) continue;
    const toDefender = { source: attacker, to: { kind: "player", player: defender }, amount, combat: true } as const;
    // An unblocked creature assigns its damage to the player it attacks (CR 510.1b).
    if (!isBlocked(state, attacker)) {
      damage.push(toDefender);
      continue;
    }
    // A blocked creature with no blockers left assigns no damage (CR 510.1c), unless it has trample: then all of it goes
    // to the player, as though every blocker had lethal damage (CR 702.19d).
    if (blockersOf(state, attacker, cards).length === 0) {
      if (keywordsOf(state, attacker, cards).includes("trample")) damage.push(toDefender);
      continue;
    }
    // As divided, or with no choice, all to its one blocker (CR 510.1c).
    const { recipients } = recipientsOf(state, attacker, defender, divisions, cards);
    const division = divisions.find((d) => d.source === attacker)?.division ?? [
      { to: recipients[0] as (typeof recipients)[number], amount },
    ];
    for (const part of division) {
      if (part.amount > 0) damage.push({ source: attacker, to: part.to, amount: part.amount, combat: true });
    }
  }
  // Each blocker assigns its damage to the attacker it blocks, if that's still in combat (CR 510.1d).
  for (const { blocker, attacker } of blocksInCombat(state, cards)) {
    if (!assignsDamageNow(state, blocker, cards)) continue;
    const amount = combatPower(state, blocker, cards);
    if (amount > 0) damage.push({ source: blocker, to: { kind: "object", object: attacker }, amount, combat: true });
  }
  return damage;
}

/** The combat damage a creature assigns: its power, or none if that's 0 or less (CR 510.1a). */
function combatPower(state: GameState, id: ObjectId, cards: CardDatabase): number {
  return Math.max(0, powerAndToughness(state, id, cards).power ?? 0);
}
