// Leaving combat while staying on the battlefield (CR 506.4): a permanent that's regenerated, or that stops being a
// creature, is removed from combat, for good. It's recorded in `Combat.removed` as it happens, so becoming a creature
// again later doesn't bring it back.

import type { CardDatabase } from "../cards/types.ts";
import { cardTypesOf } from "../rules/card-types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";

/** Combat with `id` removed from it, if it's attacking or blocking (CR 506.4); unchanged otherwise. */
export function removedFromCombat(state: GameState, id: ObjectId): GameState["combat"] {
  const combat = state.combat;
  if (combat === null || combat.removed.includes(id)) return combat;
  const inCombat = combat.attacks.some((a) => a.attacker === id) || combat.blocks.some((b) => b.blocker === id);
  return inCombat ? { ...combat, removed: [...combat.removed, id] } : combat;
}

/**
 * Every attacking or blocking permanent that has stopped being a creature is removed from combat (CR 506.4): checked
 * after each piece of work (`advance`), so it's recorded at once, before anything could make it a creature again
 * (Awakener Druid's Forest, its Druid gone).
 */
export function removeNoncreaturesFromCombat(state: GameState, cards: CardDatabase): GameState {
  const combat = state.combat;
  if (combat === null) return state;
  const declared = [...combat.attacks.map((a) => a.attacker), ...combat.blocks.map((b) => b.blocker)];
  // A blocker of several attackers is declared once per attacker; it's removed once.
  const stopped = declared.filter(
    (id, i) =>
      declared.indexOf(id) === i &&
      !combat.removed.includes(id) &&
      state.zones.battlefield.includes(id) &&
      !cardTypesOf(state, id, cards).includes("creature"),
  );
  if (stopped.length === 0) return state;
  return { ...state, combat: { ...combat, removed: [...combat.removed, ...stopped] } };
}
