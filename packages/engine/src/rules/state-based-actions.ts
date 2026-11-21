// Which state-based actions apply right now (CR 704). Only a list, as data: performing them is
// `game/state-based-actions.ts`. Listing everything from one snapshot first is what makes them simultaneous (CR 704.3).

import type { CardDatabase } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { StateBasedAction } from "../state/state-based-actions.ts";
import { keywordsOf } from "./abilities.ts";
import { cardTypesOf } from "./card-types.ts";
import { powerAndToughness } from "./power-toughness.ts";

/** Every state-based action that applies now: players in turn order, then creatures in battlefield order. */
export function stateBasedActions(state: GameState, cards: CardDatabase): StateBasedAction[] {
  const actions: StateBasedAction[] = [];
  for (const player of state.turnOrder) {
    const ps = state.players[player];
    if (ps === undefined) continue;
    if (ps.life <= 0) actions.push({ kind: "zeroLife", player });
    if (ps.attemptedDrawFromEmptyLibrary) actions.push({ kind: "drewFromEmptyLibrary", player });
  }
  for (const object of state.zones.battlefield) {
    const obj = state.objects[object];
    // Any permanent with both kinds, creature or not (CR 704.5q).
    const count = obj?.kind === "card" ? Math.min(obj.counters["+1/+1"] ?? 0, obj.counters["-1/-1"] ?? 0) : 0;
    if (count > 0) actions.push({ kind: "counterAnnihilation", object, count });
    if (obj?.kind !== "card" || !cardTypesOf(state, object, cards).includes("creature")) continue;
    const { toughness } = powerAndToughness(state, object, cards);
    if (toughness === null) continue;
    // A creature with toughness 0 or less isn't also destroyed: CR 704.5g needs toughness greater than 0.
    if (toughness <= 0) actions.push({ kind: "zeroToughness", object });
    // An indestructible creature ignores the actions that destroy (CR 702.12b). Listing one would make the check
    // "perform" it forever (D-039), so it's left off.
    else if (keywordsOf(state, object, cards).includes("indestructible")) continue;
    else if (obj.damage >= toughness) actions.push({ kind: "lethalDamage", object });
    // Destroyed once, whichever of CR 704.5g and 704.5h applies.
    else if (state.dealtDeathtouchDamage.includes(object)) actions.push({ kind: "deathtouchDamage", object });
  }
  return actions;
}
