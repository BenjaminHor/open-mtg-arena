// Attaching an Aura or Equipment to a permanent, and unattaching it (CR 701.3): performs the pipeline's `attach` and
// `unattach` events (pipeline/, D-056).

import { newTimestamp } from "../game/ids.ts";
import type { Progress } from "../game/progress.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import type { CardObject } from "../state/objects.ts";

/**
 * Attaches `object` to `to` (CR 701.3a), giving it a new timestamp (CR 613.7e, 701.3c). Already attached there, nothing
 * happens (CR 701.3b). Whether it may be attached there is the caller's to check first.
 */
export function attach(state: GameState, object: ObjectId, to: ObjectId): Progress {
  const obj = cardObject(state, object);
  if (obj.attachedTo === to && state.zones.battlefield.includes(to)) return { state, events: [] };
  const stamped = newTimestamp(state);
  const attached: CardObject = { ...obj, attachedTo: to, timestamp: stamped.timestamp };
  return {
    state: { ...stamped.state, objects: { ...stamped.state.objects, [object]: attached } },
    events: [{ type: "ATTACHED", object, to }],
  };
}

/** Unattaches `object`: it stays on the battlefield, attached to nothing (CR 701.3d). */
export function unattach(state: GameState, object: ObjectId): Progress {
  const { attachedTo, ...rest } = cardObject(state, object);
  if (attachedTo === undefined) return { state, events: [] };
  return {
    state: { ...state, objects: { ...state.objects, [object]: rest } },
    events: [{ type: "UNATTACHED", object, from: attachedTo }],
  };
}

function cardObject(state: GameState, id: ObjectId): CardObject {
  const obj = state.objects[id];
  if (obj?.kind !== "card") throw new Error(`${id} isn't a permanent`);
  return obj;
}
