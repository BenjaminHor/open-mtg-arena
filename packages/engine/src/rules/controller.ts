// Who controls an object. Every rules question about control asks this function, never an object's fields, so
// control-changing effects (layer 2, later: CR 613.1b) only have to be added here (docs/future-rules.md).

import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { zoneOf } from "../zones/zone-list.ts";

/**
 * The controller of an object that may have left the battlefield since: now if it's still an object, otherwise as it
 * last was on the battlefield (CR 608.2h). Null if there's neither.
 */
export function controllerNowOrLastKnown(state: GameState, id: ObjectId): PlayerId | null {
  if (state.objects[id] !== undefined) return controllerOf(state, id);
  // As it last existed, computed (layer 2 included) as it left (CR 608.2h); the stored controller if no snapshot was kept.
  return state.lastKnownCharacteristics[id]?.controller ?? state.lastKnown[id]?.baseController ?? null;
}

/**
 * A permanent's or spell's controller (CR 110.2, 112.2), or an ability's (CR 113.8). A card in any other zone has no
 * controller, and anything that asks gets its owner (CR 108.4, 108.4a). No effects change control yet.
 */
export function controllerOf(state: GameState, id: ObjectId): PlayerId {
  const obj = state.objects[id];
  if (obj === undefined) throw new Error(`No object ${id}`);
  if (obj.kind === "ability") return obj.baseController;
  const zone = zoneOf(state, id).zone;
  return zone === "battlefield" || zone === "stack" ? obj.baseController : obj.owner;
}
