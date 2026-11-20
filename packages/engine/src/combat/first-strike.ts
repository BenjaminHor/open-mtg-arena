// First strike and double strike (CR 510.4, 702.7, 702.4): a combat damage step for them, then a second one.

import type { CardDatabase } from "../cards/types.ts";
import { keywordsOf } from "../rules/abilities.ts";
import { attacksInCombat, isBlocking } from "../rules/combat.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";

/**
 * A combat damage step begins (CR 510.4). The first: if any attacking or blocking creature has first strike or double
 * strike, they're recorded, and only they assign damage in it. If a first strike step came before, this is the second.
 */
export function beginCombatDamageStep(state: GameState, cards: CardDatabase): GameState {
  const combat = state.combat;
  if (combat === null) return state;
  if (combat.firstStrikers !== null) return { ...state, combat: { ...combat, secondDamageStep: true } };
  const inCombat = [
    ...attacksInCombat(state, cards).map((a) => a.attacker),
    ...combat.blocks.map((b) => b.blocker).filter((b) => isBlocking(state, b, cards)),
  ];
  const strikers = inCombat.filter((id) => hasFirstStrikeOrDoubleStrike(state, id, cards));
  return strikers.length === 0 ? state : { ...state, combat: { ...combat, firstStrikers: strikers } };
}

/** Whether a second combat damage step follows the one now ending (CR 510.4): this one was a first strike step. */
export function secondDamageStepFollows(state: GameState): boolean {
  return state.combat !== null && state.combat.firstStrikers !== null && !state.combat.secondDamageStep;
}

/**
 * Whether this creature assigns combat damage in this step (CR 510.4). With no first strike step, all do. In a first
 * strike step, those with first strike or double strike as it began. In the second, the rest, plus those that have double
 * strike now: first strike gained after the first step doesn't stop a creature, first strike lost doesn't let it deal
 * damage twice (CR 702.7c), and double strike gained or lost counts (CR 702.4c–d).
 */
export function assignsDamageNow(state: GameState, id: ObjectId, cards: CardDatabase): boolean {
  const strikers = state.combat?.firstStrikers ?? null;
  if (strikers === null) return true;
  if (state.combat?.secondDamageStep !== true) return strikers.includes(id);
  return !strikers.includes(id) || keywordsOf(state, id, cards).includes("double strike");
}

function hasFirstStrikeOrDoubleStrike(state: GameState, id: ObjectId, cards: CardDatabase): boolean {
  const keywords = keywordsOf(state, id, cards);
  return keywords.includes("first strike") || keywords.includes("double strike");
}
