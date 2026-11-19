// Untapping a permanent. All untapping goes through here, so effects that stop permanents from untapping (CR 502.3)
// and "whenever ... becomes untapped" triggers have one place to plug in.

import type { Progress } from "../game/progress.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";

export function untapPermanent(state: GameState, id: ObjectId): Progress {
  const obj = state.objects[id];
  if (obj?.kind !== "card" || !obj.tapped) return { state, events: [] };
  return {
    state: { ...state, objects: { ...state.objects, [id]: { ...obj, tapped: false } } },
    events: [{ type: "PERMANENT_UNTAPPED", object: id }],
  };
}
