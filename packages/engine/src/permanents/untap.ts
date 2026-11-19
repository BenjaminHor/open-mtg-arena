// Untapping permanents. All untapping goes through here, so effects that stop permanents from untapping (CR 502.3)
// and "whenever ... becomes untapped" triggers have one place to plug in.

import type { Progress } from "../game/progress.ts";
import type { GameEvent } from "../state/events.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";

/** Untaps these permanents all at once, as one action (CR 502.3: "untap them all simultaneously"). */
export function untapPermanents(state: GameState, ids: readonly ObjectId[]): Progress {
  const objects = { ...state.objects };
  const events: GameEvent[] = [];
  for (const id of ids) {
    const obj = objects[id];
    if (obj?.kind !== "card" || !obj.tapped) continue;
    objects[id] = { ...obj, tapped: false };
    events.push({ type: "PERMANENT_UNTAPPED", object: id });
  }
  return { state: { ...state, objects }, events };
}
