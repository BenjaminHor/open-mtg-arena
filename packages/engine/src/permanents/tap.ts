// Tapping a permanent. All tapping goes through here, so "whenever ... becomes tapped" triggers have one place to
// plug in.

import type { Progress } from "../game/progress.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";

export function tapPermanent(state: GameState, id: ObjectId): Progress {
  const obj = state.objects[id];
  if (obj?.kind !== "card" || obj.tapped) throw new Error(`${id} can't be tapped`);
  return {
    state: { ...state, objects: { ...state.objects, [id]: { ...obj, tapped: true } } },
    events: [{ type: "PERMANENT_TAPPED", object: id }],
  };
}
