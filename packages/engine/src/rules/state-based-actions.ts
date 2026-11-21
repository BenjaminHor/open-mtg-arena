// Which state-based actions apply right now (CR 704). Only a list, as data: performing them is
// `game/state-based-actions.ts`. Listing everything from one snapshot first is what makes them simultaneous (CR 704.3).

import { isToken } from "../cards/card-data.ts";
import type { CardDatabase } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import type { StateBasedAction } from "../state/state-based-actions.ts";
import { keywordsOf } from "./abilities.ts";
import { attachedHost, enchantFilterOf } from "./attachment.ts";
import { cardTypesOf, subtypesOf } from "./card-types.ts";
import { controllerOf } from "./controller.ts";
import { matchesFilter } from "./object-filter.ts";
import { powerAndToughness } from "./power-toughness.ts";
import { isProtectedFrom } from "./protection.ts";

/**
 * Every state-based action that applies now: players in turn order, then tokens outside the battlefield, then Auras
 * attached illegally, then permanents in battlefield order.
 */
export function stateBasedActions(state: GameState, cards: CardDatabase): StateBasedAction[] {
  const actions: StateBasedAction[] = [];
  for (const player of state.turnOrder) {
    const ps = state.players[player];
    if (ps === undefined) continue;
    if (ps.life <= 0) actions.push({ kind: "zeroLife", player });
    if (ps.attemptedDrawFromEmptyLibrary) actions.push({ kind: "drewFromEmptyLibrary", player });
  }
  // Found from the objects, not by searching every zone: a token can be anywhere a card can (CR 111.7).
  // `for ... in` builds no array, and the token test goes first: this runs several times per action (measured, D-101).
  for (const key in state.objects) {
    const object = key as ObjectId;
    const obj = state.objects[object];
    if (obj?.kind === "card" && isToken(obj) && !state.zones.battlefield.includes(object))
      actions.push({ kind: "tokenOutsideBattlefield", object });
  }
  for (const object of state.zones.battlefield) {
    if (isAuraIllegallyAttached(state, object, cards)) actions.push({ kind: "auraIllegallyAttached", object });
  }
  for (const object of state.zones.battlefield) {
    const obj = state.objects[object];
    // Any permanent with both kinds, creature or not (CR 704.5q).
    const count = obj?.kind === "card" ? Math.min(obj.counters["+1/+1"] ?? 0, obj.counters["-1/-1"] ?? 0) : 0;
    if (count > 0) actions.push({ kind: "plusAndMinusCounters", object, count });
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

/**
 * An Aura attached to nothing, to something its enchant ability doesn't allow, or to something with protection from it
 * (CR 704.5m, 303.4c, 702.16c); or to itself, which the setup refuses and nothing in the pool can cause (an Aura that's
 * also a creature, later: CR 303.4d). The enchant filter is read with the Aura's controller as "you".
 */
function isAuraIllegallyAttached(state: GameState, aura: ObjectId, cards: CardDatabase): boolean {
  const enchant = enchantFilterOf(state, aura, cards);
  if (enchant === null || !subtypesOf(state, aura, cards).includes("Aura")) return false;
  const host = attachedHost(state, aura);
  if (host === null || host === aura) return true;
  return (
    !matchesFilter(state, host, enchant, controllerOf(state, aura), cards) || isProtectedFrom(state, host, aura, cards)
  );
}
