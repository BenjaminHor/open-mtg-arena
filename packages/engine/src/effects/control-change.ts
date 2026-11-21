// A permanent whose controller changes hasn't been under its new controller's control continuously since their most
// recent turn began (CR 302.6), so it's summoning sick again until their next turn (or it has haste); and if it was
// attacking or blocking, it's removed from combat (CR 506.4). Checked after each piece of work (`advance`), comparing
// who controls each permanent before and after: control changes as a resolved effect begins or ends, and as a static
// one (an Aura's "you control enchanted creature") starts or stops applying, with no event of its own.

import type { CardDatabase } from "../cards/types.ts";
import { removedFromCombat } from "../combat/removed-from-combat.ts";
import { layered } from "../rules/layers.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";

export function recordControlChanges(before: GameState, after: GameState, cards: CardDatabase): GameState {
  // Nothing a controller is computed from changed (D-092's inputs for layer 2), so no controller did.
  if (
    before.objects === after.objects &&
    before.effects === after.effects &&
    before.zones.battlefield === after.zones.battlefield
  )
    return after;
  const was = layered(before, cards);
  const now = layered(after, cards);
  if (was === now) return after;
  let state = after;
  for (const id of after.zones.battlefield) {
    const then = was[id]?.controller;
    if (then === undefined || then === now[id]?.controller) continue;
    const obj = state.objects[id];
    if (obj?.kind !== "card") continue;
    const objects = obj.controlledSinceTurnStart
      ? { ...state.objects, [id]: { ...obj, controlledSinceTurnStart: false } }
      : state.objects;
    state = { ...state, objects, combat: removedFromCombat(state, id as ObjectId) };
  }
  return state;
}
