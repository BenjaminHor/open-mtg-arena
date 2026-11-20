// Tapping a permanent. All tapping goes through here, so "whenever ... becomes tapped" triggers have one place to
// plug in.

import type { Progress } from "../game/progress.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";

/**
 * Only an untapped permanent can be tapped (CR 701.26a). Tapping one that's already tapped is impossible, so it does
 * nothing and no event happens (CR 101.3): nothing "becomes tapped".
 */
export function tapPermanent(state: GameState, id: ObjectId): Progress {
  const obj = state.objects[id];
  if (obj?.kind !== "card") throw new Error(`${id} isn't a permanent`);
  if (obj.tapped) return { state, events: [] };
  return {
    state: { ...state, objects: { ...state.objects, [id]: { ...obj, tapped: true } } },
    events: [{ type: "PERMANENT_TAPPED", object: id }],
  };
}
