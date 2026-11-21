// Moving a card between zones. Every zone change goes through `moveCard`, so the replacement and trigger steps of
// the event pipeline (docs/architecture.md, "Effects, events, replacements, triggers") have one place to plug in.

import { newCardId, newObjectId, newTimestamp } from "../game/ids.ts";
import type { Progress } from "../game/progress.ts";
import type { ContinuousEffect, EntersAs } from "../state/effects.ts";
import type { GameEvent } from "../state/events.ts";
import type { GameState } from "../state/game-state.ts";
import type { CardId, ObjectId, PlayerId } from "../state/ids.ts";
import type { CardObject } from "../state/objects.ts";
import type { ZoneRef } from "../state/zones.ts";
import { withZoneList, zoneList, zoneOf } from "./zone-list.ts";

export type Destination =
  /** The owner's library (CR 400.3). Index 0 is the top. */
  | { zone: "library"; position: "top" | "bottom" }
  /** The owner's hand (CR 400.3). */
  | { zone: "hand" }
  /** The owner's graveyard (CR 400.3). A card goes on top (CR 404.1), the end of the list. */
  | { zone: "graveyard" }
  /** A spell has a controller (CR 112.2). */
  | { zone: "stack"; controller: PlayerId }
  /**
   * A permanent has a controller (CR 110.2); `is`: what it is as it enters (CR 611.2e); `counters`: what it enters with
   * (CR 614.1c, 122.6); `attachedTo`: the permanent an Aura enters attached to (CR 608.3c).
   */
  | {
      zone: "battlefield";
      controller: PlayerId;
      is?: EntersAs;
      counters?: Record<string, number>;
      attachedTo?: ObjectId;
    }
  /**
   * "Onto the battlefield tapped": it enters tapped, as part of this move (CR 110.5b), so it never "becomes tapped"
   * (CR 603.2e): no `PERMANENT_TAPPED` event, the one such triggers will see.
   */
  | {
      zone: "battlefield";
      controller: PlayerId;
      tapped: true;
      is?: EntersAs;
      counters?: Record<string, number>;
      attachedTo?: ObjectId;
    }
  /** Cards in exile or the command zone have no controller (CR 108.4). */
  | { zone: "exile" | "command" };

/**
 * Moves a card to another zone, where it becomes a new object with a new id and no memory of the old one (CR 400.7):
 * untapped, no damage or counters, a new timestamp (CR 613.7d). Returns the new id and a `ZONE_CHANGED` event.
 * A card coming out of a hand or a library into a public zone also gets a new card id (D-054): the old one may have
 * been seen before it went into hiding (a cancelled spell), and keeping it would let a player follow the card through
 * a zone they can't see (CR 401.2, 402.3).
 */
export function moveCard(state: GameState, id: ObjectId, to: Destination): Progress & { newId: ObjectId } {
  // A token that already left the battlefield would stay where it is (later: CR 111.8); nothing in the pool moves one
  // twice before state-based actions.
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
  // A permanent leaving the battlefield is remembered as it last existed (CR 608.2h).
  const lastKnown = from.zone === "battlefield" ? { ...next.lastKnown, [id]: old } : next.lastKnown;
  next = { ...next, objects, lastKnown };

  const allocated = newObjectId(next);
  const stamped = newTimestamp(allocated.state);
  next = stamped.state;
  const comesIntoView = isHiddenZone(from) && !isHiddenZone(toRef);
  const minted = comesIntoView ? newCardId(next) : { id: old.cardId, state: next };
  next = minted.state;
  const card: CardObject = {
    kind: "card",
    id: allocated.id,
    cardId: minted.id,
    oracleId: old.oracleId,
    owner: old.owner,
    baseController: "controller" in to ? to.controller : old.owner,
    timestamp: stamped.timestamp,
    tapped: "tapped" in to && to.tapped,
    damage: 0,
    // What it enters with (CR 614.1c); otherwise none, the old object's having stayed with it (CR 122.2).
    counters: to.zone === "battlefield" && to.counters !== undefined ? { ...to.counters } : {},
    controlledSinceTurnStart: false,
    // A spell on the stack carries its casting choices (CR 601.2c; modes, later: CR 700.2); casting (M1-09) fills
    // them in.
    choices: to.zone === "stack" ? { modes: [], x: null, targets: [], division: null } : null,
    // A token stays a token wherever it goes, until it ceases to exist (CR 111.7, 704.5d).
    ...(old.token === undefined ? {} : { token: old.token }),
    // Attached as it enters, so it's never seen unattached (CR 608.3c); its timestamp is its entering one (attaching
    // it later gives it a new one, CR 613.7e).
    ...(to.zone === "battlefield" && to.attachedTo !== undefined ? { attachedTo: to.attachedTo } : {}),
  };
  next = { ...next, objects: { ...next.objects, [card.id]: card } };

  const list = zoneList(next, toRef);
  const toTop = to.zone === "library" && to.position === "top";
  next = withZoneList(next, toRef, toTop ? [card.id, ...list] : [...list, card.id]);
  // What it "is" as it enters applies as it enters (CR 611.2e), its timestamp after the object's (CR 613.7n).
  const entering = to.zone === "battlefield" && to.is !== undefined ? enteringAs(next, card.id, to.is) : null;
  if (entering !== null) next = entering.state;

  // "For as long as this creature remains on the battlefield" ends as it leaves (CR 611.2b).
  const ending = from.zone === "battlefield" ? effectsEndingWith(next, id) : [];
  if (ending.length > 0) next = { ...next, effects: next.effects.filter((e) => !ending.includes(e)) };

  const event: GameEvent = {
    type: "ZONE_CHANGED",
    from,
    to: toRef,
    oldId: id,
    newId: card.id,
    cardId: old.cardId,
    newCardId: card.cardId,
    object: old,
  };
  const ended = ending.map((effect): GameEvent => ({ type: "EFFECT_ENDED", effect }));
  const created: GameEvent[] = entering === null ? [] : [{ type: "EFFECT_CREATED", effect: entering.effect }];
  // Entering with counters is putting them on it (CR 122.6).
  const put = Object.entries(card.counters).map(
    ([counter, amount]): GameEvent => ({ type: "COUNTERS_PUT", object: card.id, counter, amount }),
  );
  return { state: next, events: [event, ...ended, ...created, ...put], newId: card.id };
}

/** The effects lasting "for as long as [this] remains on the battlefield", ending as `source` leaves (CR 611.2b). */
function effectsEndingWith(state: GameState, source: ObjectId): ContinuousEffect[] {
  return state.effects.filter((e) => e.duration === "whileSourceOnBattlefield" && e.source === source);
}

/** The effect a permanent enters with (CR 611.2e), made now, after its own timestamp (CR 613.7n). */
function enteringAs(state: GameState, id: ObjectId, as: EntersAs): { state: GameState; effect: ContinuousEffect } {
  const stamped = newTimestamp(state);
  const effect: ContinuousEffect = {
    source: as.source,
    controller: as.controller,
    timestamp: stamped.timestamp,
    duration: "endOfGame",
    affected: [id],
    change: { kind: "becomes", ...as.change },
  };
  return { state: { ...stamped.state, effects: [...stamped.state.effects, effect] }, effect };
}

/** Hands and libraries: zones some player can't see into (CR 400.2). */
export function isHiddenZone(zone: Pick<ZoneRef, "zone">): boolean {
  return zone.zone === "hand" || zone.zone === "library";
}

/** The card id a move gave the card: new if it came out of a hand or library into a public zone (D-054). */
export function newCardIdOf(moved: Progress & { newId: ObjectId }): CardId {
  const obj = moved.state.objects[moved.newId];
  if (obj?.kind !== "card") throw new Error(`${moved.newId} isn't a card`);
  return obj.cardId;
}
