// The declare attackers step's turn-based action (CR 508.1).

import type { CardDatabase } from "../cards/types.ts";
import { waitFor } from "../game/decide.ts";
import { andThen, type Progress } from "../game/progress.ts";
import { currentTurn } from "../game/turn.ts";
import { queueWork } from "../game/work.ts";
import { happen } from "../pipeline/happen.ts";
import type { ProposedEvent } from "../pipeline/proposed.ts";
import { keywordsOf } from "../rules/abilities.ts";
import { canAttack } from "../rules/combat.ts";
import { type Attack, newCombat } from "../state/combat.ts";
import type { GameState } from "../state/game-state.ts";

/**
 * Every attack the active player could still add to the declaration: each creature that can attack and isn't chosen
 * yet, against each other player (CR 508.1a; a choice of defenders, later: CR 508.1b). Players in turn order, creatures
 * in battlefield order.
 */
export function possibleAttacks(state: GameState, chosen: readonly Attack[], cards: CardDatabase): Attack[] {
  const active = currentTurn(state).activePlayer;
  const defenders = state.turnOrder.filter((p) => p !== active);
  return state.zones.battlefield
    .filter((id) => canAttack(state, id, active, cards) && !chosen.some((a) => a.attacker === id))
    .flatMap((attacker) => defenders.map((defender) => ({ attacker, defender })));
}

/**
 * Asks the active player for attackers, one at a time, until they finish (CR 508.1). If no creature could attack,
 * no one is asked: the declaration is empty.
 */
export function declareAttackers(state: GameState, chosen: Attack[], cards: CardDatabase): Progress {
  const active = currentTurn(state).activePlayer;
  if (chosen.length === 0 && possibleAttacks(state, chosen, cards).length === 0)
    return finishAttackers(state, [], cards);
  return { state: waitFor(state, active, { kind: "declareAttackers", chosen }), events: [] };
}

/** Why this attack can't be added, or null. */
export function attackProblem(state: GameState, chosen: readonly Attack[], attack: Attack, cards: CardDatabase) {
  const ok = possibleAttacks(state, chosen, cards).some(
    (a) => a.attacker === attack.attacker && a.defender === attack.defender,
  );
  return ok ? null : `${attack.attacker} can't attack ${attack.defender} (CR 508.1a)`;
}

/**
 * The declaration is complete. With no restrictions or requirements in the pool, any set of creatures that can each
 * attack is legal (restrictions and requirements, later: CR 508.1c–d). The attackers tap (CR 508.1f) and become
 * attacking creatures (CR 508.1k); then the active player gets priority (CR 508.2).
 */
export function finishAttackers(state: GameState, chosen: readonly Attack[], cards: CardDatabase): Progress {
  const active = currentTurn(state).activePlayer;
  const progress = happen(state, attackersTap(state, chosen, cards), cards);
  return andThen(progress, (s) => ({
    state: queueWork(
      { ...s, combat: { ...(s.combat ?? newCombat()), attacks: [...chosen] } },
      {
        kind: "givePriority",
        player: active,
      },
    ),
    events: [{ type: "ATTACKERS_DECLARED", player: active, attacks: [...chosen] }],
  }));
}

/**
 * The attackers tap together (CR 508.1f), as part of the one turn-based action that declares them (CR 508.1), except
 * those with vigilance (CR 702.20b).
 */
export function attackersTap(state: GameState, chosen: readonly Attack[], cards: CardDatabase): ProposedEvent {
  const tapping = chosen.filter(({ attacker }) => !keywordsOf(state, attacker, cards).includes("vigilance"));
  return { kind: "simultaneous", events: tapping.map(({ attacker }) => ({ kind: "tap", object: attacker }) as const) };
}
