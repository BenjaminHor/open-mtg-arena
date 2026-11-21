// The legend rule (CR 704.5j): a player who controls two or more legendary permanents with the same name chooses one,
// and the rest are put into their owners' graveyards. It's a state-based action that needs a choice, so it's asked as a
// `keepLegend` decision before the check that performs it (game/priority.ts), and the check is then made with the choices
// (`stateBasedActions`'s `kept`), so it still happens together with every other state-based action (CR 704.3).

import type { CardDatabase } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { supertypesOf } from "./card-types.ts";
import { characteristics } from "./characteristics.ts";
import { controllerOf } from "./controller.ts";

/** A set of legendary permanents one player controls that share a name (CR 704.5j), in battlefield order. */
export type LegendGroup = { controller: PlayerId; permanents: ObjectId[] };

/**
 * Each set of two or more legendary permanents (CR 205.4d) one player controls that share a name (CR 704.5j): by
 * controller in turn order, then in battlefield order. The players choose in APNAP order (CR 101.4), which
 * `game/priority.ts` asks in. A permanent with no name shares it with nothing (CR 201.2a).
 */
export function legendRuleGroups(state: GameState, cards: CardDatabase): LegendGroup[] {
  const legends = state.zones.battlefield.filter((id) => supertypesOf(state, id, cards).includes("legendary"));
  // The cheap test first: this runs before every check of state-based actions.
  if (legends.length < 2) return [];
  const groups: LegendGroup[] = [];
  for (const controller of state.turnOrder) {
    const theirs = legends.filter((id) => controllerOf(state, id, cards) === controller);
    const names = theirs.map((id) => characteristics(state, id, cards).name);
    for (const [i, name] of names.entries()) {
      if (name === "" || names.indexOf(name) !== i) continue;
      const permanents = theirs.filter((_, j) => names[j] === name);
      if (permanents.length > 1) groups.push({ controller, permanents });
    }
  }
  return groups;
}
