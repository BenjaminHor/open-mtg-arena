// Leaving combat while staying on the battlefield (CR 506.4): a permanent that's regenerated, stops being a creature, or
// changes controller is removed from the declarations it's in, for good; so is an attacked planeswalker that stops being
// a planeswalker or changes controller. It's recorded in `Combat.removed` as it happens, so becoming a creature again
// later doesn't bring it back; a block declared after that is a new declaration.

import type { CardDatabase } from "../cards/types.ts";
import { cardTypesOf } from "../rules/card-types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";

/** The parts a permanent can play in combat: attacking, blocking, or being attacked (a planeswalker, CR 506.3). */
export type CombatRole = "attacker" | "blocker" | "attacked";

/** Every role: what a change of controller removes a permanent from (CR 506.4). */
export const ALL_COMBAT_ROLES: readonly CombatRole[] = ["attacker", "blocker", "attacked"];

/**
 * Combat with `id` removed from the declarations it's in now (CR 506.4), in the roles given: as an attacker, as a
 * blocker, as an attacked planeswalker; unchanged if it's in none. Each caller names the roles its rule removes: a
 * control change removes all three, regeneration only attacking and blocking (CR 701.19a). A declaration made later (a
 * block, after it was removed as an attacker) isn't touched.
 */
export function removedFromCombat(state: GameState, id: ObjectId, roles: readonly CombatRole[]): GameState["combat"] {
  const combat = state.combat;
  if (combat === null) return combat;
  const { attackers, blockers, attacked = [] } = combat.removed;
  const asAttacker =
    roles.includes("attacker") && combat.attacks.some((a) => a.attacker === id) && !attackers.includes(id);
  const asBlocker = roles.includes("blocker") && combat.blocks.some((b) => b.blocker === id) && !blockers.includes(id);
  const asAttacked =
    roles.includes("attacked") && combat.attacks.some((a) => a.attacked === id) && !attacked.includes(id);
  if (!asAttacker && !asBlocker && !asAttacked) return combat;
  return {
    ...combat,
    removed: {
      attackers: asAttacker ? [...attackers, id] : attackers,
      blockers: asBlocker ? [...blockers, id] : blockers,
      ...(asAttacked || attacked.length > 0 ? { attacked: asAttacked ? [...attacked, id] : attacked } : {}),
    },
  };
}

/**
 * Every attacking or blocking permanent that has stopped being a creature, and every attacked planeswalker that has
 * stopped being a planeswalker, is removed from combat (CR 506.4): checked after each piece of work (`advance`), so
 * it's recorded at once, before anything could make it one again (Awakener Druid's Forest, its Druid gone).
 */
export function removeTypeChangesFromCombat(state: GameState, cards: CardDatabase): GameState {
  const combat = state.combat;
  if (combat === null) return state;
  const declared = [...combat.attacks.map((a) => a.attacker), ...combat.blocks.map((b) => b.blocker)];
  const attacked = combat.attacks.flatMap((a) => (a.attacked === undefined ? [] : [a.attacked]));
  const isNo = (id: ObjectId, type: "creature" | "planeswalker") =>
    state.zones.battlefield.includes(id) && !cardTypesOf(state, id, cards).includes(type);
  // Each role is dropped on its own, so a permanent that stops being a creature but is still a planeswalker stays
  // attacked (a creature planeswalker, later: CR 506.4d). A blocker of several attackers is removed once.
  const changes: [ObjectId, CombatRole[]][] = [
    ...declared
      .filter((id) => isNo(id, "creature"))
      .map((id): [ObjectId, CombatRole[]] => [id, ["attacker", "blocker"]]),
    ...attacked.filter((id) => isNo(id, "planeswalker")).map((id): [ObjectId, CombatRole[]] => [id, ["attacked"]]),
  ];
  if (changes.length === 0) return state;
  let next: GameState = state;
  for (const [id, roles] of changes) next = { ...next, combat: removedFromCombat(next, id, roles) };
  return next.combat === combat ? state : next;
}
