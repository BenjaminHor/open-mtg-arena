// Moving a card between zones. Every zone change goes through `moveCard`, so the replacement and trigger steps of
// the event pipeline (docs/architecture.md, "Effects, events, replacements, triggers") have one place to plug in.

import { newObjectId, newTimestamp } from "../game/ids.ts";
import type { Progress } from "../game/progress.ts";
import type { GameEvent } from "../state/events.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { CardObject } from "../state/objects.ts";
import type { ZoneRef } from "../state/zones.ts";
import { withZoneList, zoneList, zoneOf } from "./zone-list.ts";

export type Destination =
  /** The owner's library (CR 400.3). Index 0 is the top. */
  | { zone: "library"; position: "top" | "bottom" }
  /** The owner's hand or graveyard (CR 400.3). A graveyard card goes on top (CR 404.1), the end of the list. */
  | { zone: "hand" | "graveyard" }
  /** Permanents and spells have a controller (CR 110.2, 112.2). */
  | { zone: "battlefield" | "stack"; controller: PlayerId }
  /** Cards in exile or the command zone have no controller (CR 108.4). */
  | { zone: "exile" | "command" };

/**
 * Moves a card to another zone, where it becomes a new object with a new id and no memory of the old one (CR 400.7):
 * untapped, no damage or counters, a new timestamp (CR 613.7d). Returns the new id and a `ZONE_CHANGED` event.
 */
export function moveCard(state: GameState, id: ObjectId, to: Destination): Progress & { newId: ObjectId } {
  const old = state.objects[id];
  if (old === undefined || old.kind !== "card") throw new Error(`${id} isn't a card`);
  const from = zoneOf(state, id);
  const toRef: ZoneRef =
    to.zone === "library" || to.zone === "hand" || to.zone === "graveyard"
      ? { zone: to.zone, player: old.owner }
      : { zone: to.zone };

  let next = withZoneList(
    state,
    from,
    zoneList(state, from).filter((x) => x !== id),
  );
  const { [id]: _removed, ...objects } = next.objects;
  next = { ...next, objects };

  const allocated = newObjectId(next);
  const stamped = newTimestamp(allocated.state);
  next = stamped.state;
  const card: CardObject = {
    kind: "card",
    id: allocated.id,
    cardId: old.cardId,
    oracleId: old.oracleId,
    owner: old.owner,
    baseController: "controller" in to ? to.controller : old.owner,
    timestamp: stamped.timestamp,
    tapped: false,
    damage: 0,
    counters: {},
    controlledSinceTurnStart: false,
    choices: null,
  };
  next = { ...next, objects: { ...next.objects, [card.id]: card } };

  const list = zoneList(next, toRef);
  const toTop = to.zone === "library" && to.position === "top";
  next = withZoneList(next, toRef, toTop ? [card.id, ...list] : [...list, card.id]);

  const event: GameEvent = {
    type: "ZONE_CHANGED",
    from,
    to: toRef,
    oldId: id,
    newId: card.id,
    cardId: old.cardId,
    object: old,
  };
  return { state: next, events: [event], newId: card.id };
}
