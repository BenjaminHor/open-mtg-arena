// Removing marked damage (CR 514.2).

import type { Progress } from "../game/progress.ts";
import type { GameEvent } from "../state/events.ts";
import type { GameState } from "../state/game-state.ts";

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
  return { state: { ...state, objects }, events };
}
