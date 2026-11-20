// Untapping a permanent. All untapping goes through here, so effects that stop permanents from untapping (CR 502.3)
// and "whenever ... becomes untapped" triggers have one place to plug in. The untap step untaps them all as one
// `simultaneous` event (CR 502.3: "untap them all simultaneously").

import type { Progress } from "../game/progress.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";

/** Only a tapped permanent can be untapped (CR 701.26b); untapping an untapped one does nothing (CR 101.3). */
export function untapPermanent(state: GameState, id: ObjectId): Progress {
  const obj = state.objects[id];
  if (obj?.kind !== "card") throw new Error(`${id} isn't a permanent`);
  if (!obj.tapped) return { state, events: [] };
  return {
    state: { ...state, objects: { ...state.objects, [id]: { ...obj, tapped: false } } },
    events: [{ type: "PERMANENT_UNTAPPED", object: id }],
  };
}
