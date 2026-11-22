// Who controls an object. Every rules question about control asks this function, never an object's fields, so
// control-changing effects are applied in one place: layer 2 of the layer pass (CR 613.1b, `control-effects.ts`).

import type { CardDatabase } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { zoneOf } from "../zones/zone-list.ts";
import { anyControlEffects } from "./control-effects.ts";
import { layeredOf } from "./layers.ts";

/**
 * The controller of an object that may have left the battlefield since: now if it's still an object, otherwise as it
 * last existed on the battlefield or the stack (CR 608.2h). Null if there's neither.
 */
export function controllerNowOrLastKnown(state: GameState, id: ObjectId, cards: CardDatabase): PlayerId | null {
  if (state.objects[id] !== undefined) return controllerOf(state, id, cards);
  // As it last existed, computed (layer 2 included) as it left (CR 608.2h); the stored controller if no snapshot was kept.
  return state.lastKnownCharacteristics[id]?.controller ?? state.lastKnown[id]?.baseController ?? null;
}

/**
 * A permanent's or spell's controller (CR 110.2, 112.2), or an ability's (CR 113.8). A card in any other zone has no
 * controller, and anything that asks gets its owner (CR 108.4, 108.4a). A permanent's is changed by layer 2 effects.
 */
export function controllerOf(state: GameState, id: ObjectId, cards: CardDatabase): PlayerId {
  const obj = state.objects[id];
  if (obj === undefined) throw new Error(`No object ${id}`);
  if (obj.kind === "ability") return obj.baseController;
  const zone = zoneOf(state, id).zone;
  // A permanent's, from the layer pass, which does layer 2 (CR 613.1b): one place, so nothing can disagree with it. With
  // no control effect in the game, the pass would give the stored controller (CR 110.2), so that's read without it
  // (measured: asking for the pass here made each action a fifth slower). The fuzzer checks the two agree.
  if (zone === "battlefield") {
    if (!anyControlEffects(state, cards)) return obj.baseController;
    const permanent = layeredOf(state, id, cards);
    if (permanent === null) throw new Error(`No layer pass for ${id}`);
    return permanent.controller;
  }
  return zone === "stack" ? obj.baseController : obj.owner;
}
