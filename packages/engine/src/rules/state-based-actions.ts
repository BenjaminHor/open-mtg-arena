// Which state-based actions apply right now (CR 704). Only a list, as data: performing them is
// `game/state-based-actions.ts`. Listing everything from one snapshot first is what makes them simultaneous (CR 704.3).

import { isToken } from "../cards/card-data.ts";
import type { CardDatabase } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import type { StateBasedAction } from "../state/state-based-actions.ts";
import { keywordsOf } from "./abilities.ts";
import { attachedHost, isAura } from "./attachment.ts";
import { canEnchant } from "./can-enchant.ts";
import { cardTypesOf, subtypesOf } from "./card-types.ts";
import { controllerOf } from "./controller.ts";
import { legendRuleGroups } from "./legend-rule.ts";
import { loyaltyOf } from "./loyalty.ts";
import { powerAndToughness } from "./power-toughness.ts";
import { isProtectedFrom } from "./protection.ts";

/**
 * Every state-based action that applies now: players in turn order, then tokens outside the battlefield, then permanents
 * in battlefield order, then the legend rule. The legend rule only for the sets `kept` chooses from: a caller must ask
 * the choice first (`askToKeepLegend`, D-109).
 */
export function stateBasedActions(
  state: GameState,
  cards: CardDatabase,
  kept: readonly ObjectId[] = [],
): StateBasedAction[] {
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
    const obj = state.objects[object];
    if (isAuraIllegallyAttached(state, object, cards)) actions.push({ kind: "auraIllegallyAttached", object });
    if (isEquipmentIllegallyAttached(state, object, cards))
      actions.push({ kind: "equipmentIllegallyAttached", object });
    // Any permanent with both kinds, creature or not (CR 704.5q).
    const count = obj?.kind === "card" ? Math.min(obj.counters["+1/+1"] ?? 0, obj.counters["-1/-1"] ?? 0) : 0;
    if (count > 0) actions.push({ kind: "plusAndMinusCounters", object, count });
    if (obj?.kind !== "card") continue;
    const types = cardTypesOf(state, object, cards);
    // Put into the graveyard, not destroyed (CR 704.5i): a creature planeswalker with lethal damage too goes this way,
    // once, as the legend rule does.
    if (types.includes("planeswalker") && loyaltyOf(state, object) <= 0) {
      actions.push({ kind: "zeroLoyalty", object });
      continue;
    }
    if (!types.includes("creature")) continue;
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
  // The legend rule, for each set a permanent was chosen to keep from (CR 704.5j): asked before the check, so a set
  // with no choice yet isn't listed here (game/priority.ts; every caller of a check asks first). An unkept one is put
  // into its owner's graveyard, not destroyed, so a regeneration shield can't save it (CR 614.8): that wins over its
  // lethal or deathtouch damage, and it leaves once. One already put into the graveyard by another action goes by that.
  if (kept.length === 0) return actions;
  const unkept = legendRuleGroups(state, cards).flatMap((group) =>
    group.permanents.some((id) => kept.includes(id)) ? group.permanents.filter((id) => !kept.includes(id)) : [],
  );
  const destroyed = (a: StateBasedAction) =>
    (a.kind === "lethalDamage" || a.kind === "deathtouchDamage") && unkept.includes(a.object);
  const putAway = actions.flatMap((a) =>
    a.kind === "zeroToughness" || a.kind === "zeroLoyalty" || a.kind === "auraIllegallyAttached" ? [a.object] : [],
  );
  return [
    ...actions.filter((a) => !destroyed(a)),
    ...unkept.filter((id) => !putAway.includes(id)).map((object) => ({ kind: "legendRule", object }) as const),
  ];
}

/**
 * An Aura attached to nothing, to something its enchant ability doesn't allow, or to something with protection from it
 * (CR 704.5m, 303.4c, 702.16c); or to itself, which the setup refuses and nothing in the pool can cause (an Aura that's
 * also a creature, later: CR 303.4d). The enchant filter is read with the Aura's controller as "you".
 */
function isAuraIllegallyAttached(state: GameState, aura: ObjectId, cards: CardDatabase): boolean {
  if (!isAura(state, aura, cards)) return false;
  const host = attachedHost(state, aura);
  return host === null || !canEnchant(state, aura, host, controllerOf(state, aura, cards), cards);
}

/**
 * An Equipment attached to something that isn't a creature, to itself, to something with protection from it, or to
 * something that has left the battlefield (CR 704.5n, 301.5c, 702.16d). It stays on the battlefield, unattached. An
 * Equipment that's also a creature can't equip anything either; nothing in the pool makes one a creature.
 */
function isEquipmentIllegallyAttached(state: GameState, equipment: ObjectId, cards: CardDatabase): boolean {
  const obj = state.objects[equipment];
  if (obj?.kind !== "card" || obj.attachedTo === undefined) return false;
  if (!subtypesOf(state, equipment, cards).includes("Equipment")) return false;
  const host = attachedHost(state, equipment);
  if (host === null || host === equipment) return true;
  return !cardTypesOf(state, host, cards).includes("creature") || isProtectedFrom(state, host, equipment, cards);
}
