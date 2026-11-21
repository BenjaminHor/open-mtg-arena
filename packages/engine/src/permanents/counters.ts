// Putting counters on a permanent and removing them (CR 122.1, 122.6). Both go through the pipeline, so triggers on
// counters being put or removed (Protean Hydra) and later replacements (CR 614.1) see them.

import type { Progress } from "../game/progress.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";

/**
 * Puts `amount` counters of a kind on a permanent; none if it's gone or the amount isn't positive (CR 101.3). Only on
 * the battlefield for now: counters in other zones (time counters in exile, suspend) come with their cards.
 */
export function putCounters(state: GameState, id: ObjectId, counter: string, amount: number): Progress {
  const obj = state.objects[id];
  if (obj?.kind !== "card" || !state.zones.battlefield.includes(id) || amount <= 0) return { state, events: [] };
  const counters = { ...obj.counters, [counter]: (obj.counters[counter] ?? 0) + amount };
  return {
    state: { ...state, objects: { ...state.objects, [id]: { ...obj, counters } } },
    events: [{ type: "COUNTERS_PUT", object: id, counter, amount }],
  };
}

/**
 * Removes up to `amount` counters of a kind: only as many as it has, the rest being impossible (CR 101.3). From any
 * object that has them: removing needs no zone check, as only permanents get counters today.
 */
export function removeCounters(state: GameState, id: ObjectId, counter: string, amount: number): Progress {
  const obj = state.objects[id];
  const has = obj?.kind === "card" ? (obj.counters[counter] ?? 0) : 0;
  const removed = Math.min(has, amount);
  if (obj?.kind !== "card" || removed <= 0) return { state, events: [] };
  const { [counter]: _, ...others } = obj.counters;
  const counters = has - removed > 0 ? { ...others, [counter]: has - removed } : others;
  return {
    state: { ...state, objects: { ...state.objects, [id]: { ...obj, counters } } },
    events: [{ type: "COUNTERS_REMOVED", object: id, counter, amount: removed }],
  };
}
