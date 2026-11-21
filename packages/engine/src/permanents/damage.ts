// Damage marked on permanents (CR 120.3e), and removing it (CR 514.2).

import type { Progress } from "../game/progress.ts";
import type { GameEvent } from "../state/events.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";

/** Marks damage on a creature (CR 120.3e). The `DAMAGE_DEALT` event already reports it. */
export function markDamage(state: GameState, id: ObjectId, amount: number): Progress {
  const obj = state.objects[id];
  if (obj?.kind !== "card") throw new Error(`No permanent ${id}`);
  return {
    state: { ...state, objects: { ...state.objects, [id]: { ...obj, damage: obj.damage + amount } } },
    events: [],
  };
}

/** Removes the damage marked on every permanent, whoever controls it (CR 514.2). */
export function removeAllDamage(state: GameState): Progress {
  const objects = { ...state.objects };
  const events: GameEvent[] = [];
  for (const id of state.zones.battlefield) {
    const obj = objects[id];
    if (obj?.kind === "card" && obj.damage > 0) {
      objects[id] = { ...obj, damage: 0 };
      events.push({ type: "DAMAGE_REMOVED", object: id, amount: obj.damage });
    }
  }
  // Unchanged when nothing had damage: keeping the objects record keeps the layer pass kept for it (D-092).
  return { state: events.length === 0 ? state : { ...state, objects }, events };
}
