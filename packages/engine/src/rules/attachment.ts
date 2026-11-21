// What an Aura or Equipment is attached to (CR 303.4b; Equipment, later: CR 301.5a), and what an Aura may enchant (CR 702.5a). The one place
// that reads `CardObject.attachedTo`, so a host that has left the battlefield (a new object, CR 400.7) is never read as
// still enchanted.

import { cardDataOf } from "../cards/card-data.ts";
import type { CardDatabase, ObjectFilter } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";

/** The permanent `id` is attached to, or null: attached to nothing, or to an object that's no longer on the battlefield. */
export function attachedHost(state: Pick<GameState, "objects" | "zones">, id: ObjectId): ObjectId | null {
  return attachedHostIn(state.objects, state.zones.battlefield, id);
}

/** `attachedHost`, from the objects and the battlefield alone, as the layer pass has them. */
export function attachedHostIn(
  objects: GameState["objects"],
  battlefield: readonly ObjectId[],
  id: ObjectId,
): ObjectId | null {
  const obj = objects[id];
  const host = obj?.kind === "card" ? obj.attachedTo : undefined;
  return host !== undefined && battlefield.includes(host) ? host : null;
}

/** The permanents attached to `host`, a permanent on the battlefield (CR 303.4b; Equipment, later: CR 301.5a), in battlefield order. */
export function attachmentsOf(state: Pick<GameState, "objects" | "zones">, host: ObjectId): ObjectId[] {
  return state.zones.battlefield.filter((id) => {
    const obj = state.objects[id];
    return obj?.kind === "card" && obj.attachedTo === host;
  });
}

/**
 * What an Aura can enchant, from its enchant ability (CR 702.5a), or null if it has none. Printed only: nothing in the
 * pool changes an enchant ability (layer 3 text changes, later: CR 613.1c).
 */
export function enchantFilterOf(state: GameState, id: ObjectId, cards: CardDatabase): ObjectFilter | null {
  const obj = state.objects[id];
  return obj?.kind === "card" ? (cardDataOf(obj, cards)?.def.enchant ?? null) : null;
}
