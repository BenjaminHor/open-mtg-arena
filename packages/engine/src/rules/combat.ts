// Combat rules questions (CR 506–510): who can attack, who can block what, and who's still in combat. Restrictions on
// one creature ("can't block", protection) are named checks here (CR 509.1b; "can't attack", later: CR 508.1c). Rules
// about the whole declaration will be checked at `finishDeclaring`: restrictions like menace and "can't attack alone"
// (later: CR 508.1c, 509.1b, 702.111b) and requirements like "attacks each combat if able" (later: CR 508.1d, 509.1c).

import type { CardDatabase } from "../cards/types.ts";
import type { Attack, Block } from "../state/combat.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { keywordsOf } from "./abilities.ts";
import { cardTypesOf } from "./card-types.ts";
import { controllerOf } from "./controller.ts";
import { isFreeOfSummoningSickness } from "./summoning-sickness.ts";

/** A creature permanent (CR 506.3: only creatures attack or block). */
function isCreaturePermanent(state: GameState, id: ObjectId, cards: CardDatabase): boolean {
  return state.zones.battlefield.includes(id) && cardTypesOf(state, id, cards).includes("creature");
}

/**
 * Whether `player` may declare this creature as an attacker (CR 508.1a): an untapped creature they control that has
 * haste or has been under their control continuously since their most recent turn began (CR 302.6, 702.10b).
 */
export function canAttack(state: GameState, id: ObjectId, player: PlayerId, cards: CardDatabase): boolean {
  const obj = state.objects[id];
  if (obj?.kind !== "card" || !isCreaturePermanent(state, id, cards)) return false;
  if (controllerOf(state, id) !== player || obj.tapped) return false;
  return isFreeOfSummoningSickness(state, id, cards);
}

/** Whether `blocker` may block `attacker` (CR 509.1a–b): an untapped creature, obeying evasion abilities. */
export function canBlock(state: GameState, blocker: ObjectId, attacker: ObjectId, cards: CardDatabase): boolean {
  const obj = state.objects[blocker];
  if (obj?.kind !== "card" || !isCreaturePermanent(state, blocker, cards) || obj.tapped) return false;
  return flyingAllowsBlock(state, blocker, attacker, cards);
}

/** A creature with flying can't be blocked except by creatures with flying or reach (CR 702.9b, 702.17b). */
function flyingAllowsBlock(state: GameState, blocker: ObjectId, attacker: ObjectId, cards: CardDatabase): boolean {
  if (!keywordsOf(state, attacker, cards).includes("flying")) return true;
  const keywords = keywordsOf(state, blocker, cards);
  return keywords.includes("flying") || keywords.includes("reach");
}

/**
 * The attacks still in combat (CR 506.4): a creature that left the battlefield is a new object (CR 400.7), so its old
 * id is no longer there; one that stopped being a creature is out too. A change of controller also removes it, which
 * needs control-changing effects (none yet) and the controller stored with the attack.
 */
export function attacksInCombat(state: GameState, cards: CardDatabase): Attack[] {
  return (state.combat?.attacks ?? []).filter((a) => isCreaturePermanent(state, a.attacker, cards));
}

/** Whether an attacker is blocked: it had a blocker declared for it, even if that blocker has gone (CR 509.1h). */
export function isBlocked(state: GameState, attacker: ObjectId): boolean {
  return state.combat?.blocks.some((b) => b.attacker === attacker) ?? false;
}

/** The blocks still in combat: both creatures still in it (CR 506.4). */
export function blocksInCombat(state: GameState, cards: CardDatabase): Block[] {
  const combat = state.combat;
  if (combat === null) return [];
  const attacking = attacksInCombat(state, cards).map((a) => a.attacker);
  return combat.blocks.filter((b) => isCreaturePermanent(state, b.blocker, cards) && attacking.includes(b.attacker));
}

/** Whether this is an attacking creature now (CR 508.1k): declared as an attacker and not removed from combat. */
export function isAttacking(state: GameState, id: ObjectId, cards: CardDatabase): boolean {
  return attacksInCombat(state, cards).some((a) => a.attacker === id);
}

/**
 * Whether this is a blocking creature now (CR 509.1g): declared as a blocker and not removed from combat (CR 506.4),
 * even if the creature it blocked has left combat. So not `blocksInCombat`, which drops those blocks.
 */
export function isBlocking(state: GameState, id: ObjectId, cards: CardDatabase): boolean {
  return (state.combat?.blocks ?? []).some((b) => b.blocker === id) && isCreaturePermanent(state, id, cards);
}
