// Combat rules questions (CR 506–510): who can attack, who can block what, and who's still in combat. Restrictions on
// one creature (defender, evasion, "can't block"; protection, CR 702.16f) are named checks here (CR 508.1c,
// 509.1b). Rules about the whole declaration ("can't attack alone", requirements; menace, later: CR 702.111b) are in
// combat/declaration-rules.ts, checked as a declaration is finished.

import type { CardDatabase, Keyword } from "../cards/types.ts";
import type { Attack, Block } from "../state/combat.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { keywordsOf, staticAbilitiesOf } from "./abilities.ts";
import { cardTypesOf, subtypesOf } from "./card-types.ts";
import { controllerOf } from "./controller.ts";
import { matchesFilter } from "./object-filter.ts";
import { isProtectedFrom } from "./protection.ts";
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
  // Defender: a restriction on attacking (CR 702.3b, 508.1c).
  if (keywordsOf(state, id, cards).includes("defender")) return false;
  return isFreeOfSummoningSickness(state, id, cards);
}

/**
 * Whether `blocker` may block `attacker` (CR 509.1a–b): an untapped creature, obeying the restrictions on it and the
 * attacker's evasion abilities, which are cumulative (CR 509.1b).
 */
export function canBlock(state: GameState, blocker: ObjectId, attacker: ObjectId, cards: CardDatabase): boolean {
  const obj = state.objects[blocker];
  if (obj?.kind !== "card" || !isCreaturePermanent(state, blocker, cards) || obj.tapped) return false;
  if (cantBlockNow(state, blocker)) return false;
  return (
    flyingAllowsBlock(state, blocker, attacker, cards) &&
    landwalkAllowsBlock(state, blocker, attacker, cards) &&
    cantBeBlockedAllowsBlock(state, blocker, attacker, cards) &&
    // An attacker with protection can't be blocked by creatures with the quality (CR 702.16f).
    !isProtectedFrom(state, attacker, blocker, cards)
  );
}

/** "Can't block this turn" from a resolved spell (Panic Attack): a restriction on the creature (CR 509.1b). */
function cantBlockNow(state: GameState, blocker: ObjectId): boolean {
  return state.effects.some((e) => e.change.kind === "cantBlock" && e.affected.includes(blocker));
}

/** The land type each landwalk keyword in the pool names (CR 702.14a). */
const LANDWALK: Partial<Record<Keyword, string>> = { swampwalk: "Swamp", forestwalk: "Forest" };

/**
 * A creature with landwalk can't be blocked while the defending player controls a land of that type (CR 702.14c): the
 * blocker's controller, the player it blocks for. Each landwalk ability is checked on its own.
 */
function landwalkAllowsBlock(state: GameState, blocker: ObjectId, attacker: ObjectId, cards: CardDatabase): boolean {
  const defender = controllerOf(state, blocker);
  const landTypes = keywordsOf(state, attacker, cards).flatMap((k) => LANDWALK[k] ?? []);
  return !landTypes.some((landType) =>
    state.zones.battlefield.some(
      (id) =>
        controllerOf(state, id) === defender &&
        cardTypesOf(state, id, cards).includes("land") &&
        subtypesOf(state, id, cards).includes(landType),
    ),
  );
}

/**
 * "Can't be blocked", or "can't be blocked except by [filter]" (Dread Warlock), an evasion ability (CR 509.1b). The
 * filter is read relative to the attacker's controller, the ability's "you" (CR 109.5).
 */
function cantBeBlockedAllowsBlock(state: GameState, blocker: ObjectId, attacker: ObjectId, cards: CardDatabase) {
  // "Can't be blocked this turn" from a resolved effect (Merfolk Sovereign's ability), a restriction like the static.
  if (state.effects.some((e) => e.change.kind === "cantBeBlocked" && e.affected.includes(attacker))) return false;
  return staticAbilitiesOf(state, attacker, cards).every(
    (ability) =>
      ability.kind !== "cantBeBlocked" ||
      (ability.except !== undefined &&
        matchesFilter(state, blocker, ability.except, controllerOf(state, attacker), cards)),
  );
}

/** Whether this creature may block more than one attacker (Palace Guard; CR 509.1a gives each blocker one, CR 101.1). */
export function canBlockAnyNumber(state: GameState, blocker: ObjectId, cards: CardDatabase): boolean {
  return staticAbilitiesOf(state, blocker, cards).some((ability) => ability.kind === "canBlockAnyNumber");
}

/** A creature with flying can't be blocked except by creatures with flying or reach (CR 702.9b, 702.17b). */
function flyingAllowsBlock(state: GameState, blocker: ObjectId, attacker: ObjectId, cards: CardDatabase): boolean {
  if (!keywordsOf(state, attacker, cards).includes("flying")) return true;
  const keywords = keywordsOf(state, blocker, cards);
  return keywords.includes("flying") || keywords.includes("reach");
}

/**
 * Whether a creature declared in combat is still in it (CR 506.4): one that left the battlefield is a new object
 * (CR 400.7), so its old id is no longer there; one that stopped being a creature is out too, and so is one an effect
 * removed (regenerated, `Combat.removed`). A change of controller also removes it, which needs control-changing effects
 * (none yet) and the controller stored with the attack.
 */
function stillInCombat(state: GameState, id: ObjectId, cards: CardDatabase): boolean {
  return isCreaturePermanent(state, id, cards) && !(state.combat?.removed.includes(id) ?? false);
}

/** The attacks still in combat (CR 506.4). */
export function attacksInCombat(state: GameState, cards: CardDatabase): Attack[] {
  return (state.combat?.attacks ?? []).filter((a) => stillInCombat(state, a.attacker, cards));
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
  return combat.blocks.filter((b) => stillInCombat(state, b.blocker, cards) && attacking.includes(b.attacker));
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
  return (state.combat?.blocks ?? []).some((b) => b.blocker === id) && stillInCombat(state, id, cards);
}
