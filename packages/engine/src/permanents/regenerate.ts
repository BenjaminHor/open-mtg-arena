// Regenerating a permanent (CR 701.19a), in place of its destruction (`pipeline/replacements.ts`): one regeneration
// shield on it is used up, all damage marked on it is removed, its controller taps it, and if it's attacking or
// blocking it's removed from combat (CR 506.4). It stays on the battlefield, the same object.

import { removedFromCombat } from "../combat/removed-from-combat.ts";
import type { Progress } from "../game/progress.ts";
import type { GameEvent } from "../state/events.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import { tapPermanent } from "./tap.ts";

export function regenerate(state: GameState, id: ObjectId): Progress {
  const obj = state.objects[id];
  if (obj?.kind !== "card" || !state.zones.battlefield.includes(id)) throw new Error(`${id} isn't a permanent`);
  // One shield is used up; several are interchangeable (D-086).
  const shield = state.replacements.findIndex((r) => r.kind === "regenerationShield" && r.object === id);
  if (shield === -1) throw new Error(`${id} has no regeneration shield`);
  const events: GameEvent[] = [{ type: "PERMANENT_REGENERATED", object: id }];
  if (obj.damage > 0) events.push({ type: "DAMAGE_REMOVED", object: id, amount: obj.damage });
  const healed: GameState = {
    ...state,
    replacements: state.replacements.filter((_, i) => i !== shield),
    objects: { ...state.objects, [id]: { ...obj, damage: 0 } },
    // Only as an attacking or blocking creature (CR 701.19a): a regenerated planeswalker stays attacked.
    combat: removedFromCombat(state, id, ["attacker", "blocker"]),
  };
  const tapped = tapPermanent(healed, id);
  return { state: tapped.state, events: [...events, ...tapped.events] };
}
