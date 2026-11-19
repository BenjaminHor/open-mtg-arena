// Abilities on the stack. An ability isn't a card, so it never changes zones: it's created on the stack (CR 602.2a,
// 405.1) and, when it resolves, is countered or is removed, it ceases to exist (CR 608.2n, 113.7).

import { newObjectId, newTimestamp } from "../game/ids.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, OracleId, PlayerId } from "../state/ids.ts";
import type { AbilityObject, AbilityRef } from "../state/objects.ts";

/** Creates an ability on top of the stack, controlled by the player who activated it (CR 602.2a, 113.8). */
export function putAbilityOnStack(
  state: GameState,
  source: ObjectId,
  sourceOracleId: OracleId,
  ability: AbilityRef,
  controller: PlayerId,
): { state: GameState; id: ObjectId } {
  const allocated = newObjectId(state);
  const stamped = newTimestamp(allocated.state);
  const obj: AbilityObject = {
    kind: "ability",
    id: allocated.id,
    source,
    sourceOracleId,
    ability,
    baseController: controller,
    timestamp: stamped.timestamp,
    choices: { modes: [], x: null, targets: [] },
  };
  const next = stamped.state;
  return {
    state: {
      ...next,
      objects: { ...next.objects, [obj.id]: obj },
      zones: { ...next.zones, stack: [...next.zones.stack, obj.id] },
    },
    id: obj.id,
  };
}

/** The ability leaves the stack and ceases to exist. */
export function removeAbilityFromStack(state: GameState, id: ObjectId): GameState {
  const { [id]: _gone, ...objects } = state.objects;
  return { ...state, objects, zones: { ...state.zones, stack: state.zones.stack.filter((x) => x !== id) } };
}
