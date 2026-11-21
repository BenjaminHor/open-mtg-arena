// A permanent whose controller changes hasn't been under its new controller's control continuously since their most
// recent turn began (CR 302.6), so it's summoning sick again until their next turn (or it has haste). Checked as a
// control effect begins and as it ends, comparing who controls each affected permanent before and after. Static control
// effects (M2-12) have no such moment: control then changes with whatever moves the Aura, so the check belongs beside
// `removeNoncreaturesFromCombat` in `advance`, comparing controllers before and after each piece of work. There, too:
// an attacking or blocking creature whose controller changes is removed from combat (later: CR 506.4).

import { controllerOf } from "../rules/controller.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";

export function recordControlChanges(before: GameState, after: GameState, ids: readonly ObjectId[]): GameState {
  let objects = after.objects;
  for (const id of ids) {
    const obj = objects[id];
    // Tokens are card objects too (D-101); a copy of a permanent will need checking here (future-rules).
    if (obj?.kind !== "card" || !after.zones.battlefield.includes(id) || !before.zones.battlefield.includes(id))
      continue;
    if (controllerOf(before, id) === controllerOf(after, id) || !obj.controlledSinceTurnStart) continue;
    objects = { ...objects, [id]: { ...obj, controlledSinceTurnStart: false } };
  }
  return objects === after.objects ? after : { ...after, objects };
}
