// The legend rule (CR 704.5j): a player who controls two or more legendary permanents with the same name chooses one,
// and the rest are put into their owners' graveyards. It's a state-based action that needs a choice, so it's asked as a
// `keepLegend` decision before the check that performs it (game/priority.ts), and the check is then made with the choices
// (`stateBasedActions`'s `kept`), so it still happens together with every other state-based action (CR 704.3).

import { cardDataOf } from "../cards/card-data.ts";
import type { CardDatabase } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import { supertypesOf } from "./card-types.ts";
import { controllerOf } from "./controller.ts";

/**
 * Each set of legendary permanents one player controls that share a name, two or more (CR 704.5j): by controller in
 * turn order, then in battlefield order. The players choose in APNAP order (CR 101.4), which `game/priority.ts` asks in. Names are printed names: nothing in the
 * pool changes one (later: CR 201.2, copies and text changes).
 */
export function legendRuleGroups(state: GameState, cards: CardDatabase): ObjectId[][] {
  const legends = state.zones.battlefield.filter((id) => supertypesOf(state, id, cards).includes("legendary"));
  // The cheap test first: this runs before every check of state-based actions.
  if (legends.length < 2) return [];
  const groups: ObjectId[][] = [];
  for (const player of state.turnOrder) {
    const theirs = legends.filter((id) => controllerOf(state, id, cards) === player);
    const names = theirs.map((id) => nameOf(state, id, cards));
    for (const [i, name] of names.entries()) {
      if (names.indexOf(name) !== i) continue;
      const same = theirs.filter((_, j) => names[j] === name);
      if (same.length > 1) groups.push(same);
    }
  }
  return groups;
}

function nameOf(state: GameState, id: ObjectId, cards: CardDatabase): string {
  const obj = state.objects[id];
  return obj?.kind === "card" ? (cardDataOf(obj, cards)?.printed.name ?? "") : "";
}
