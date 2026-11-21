// Performing an event, after replacement effects have had their say: the one place that calls the primitives that
// change the game (only-the-pipeline-performs.test.ts checks it).

import type { CardDatabase } from "../cards/types.ts";
import { dealDamage } from "../effects/deal-damage.ts";
import { gainLife, loseLife } from "../effects/life.ts";
import { countLandPlay } from "../game/land-played.ts";
import { andThen, type Progress } from "../game/progress.ts";
import { addMana } from "../mana/pool.ts";
import { putCounters, removeCounters } from "../permanents/counters.ts";
import { destroy } from "../permanents/destroy.ts";
import { regenerate } from "../permanents/regenerate.ts";
import { sacrifice } from "../permanents/sacrifice.ts";
import { tapPermanent } from "../permanents/tap.ts";
import { untapPermanent } from "../permanents/untap.ts";
import { type Characteristics, characteristics } from "../rules/characteristics.ts";
import type { GameState, LastKnownCharacteristics } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import { counterObject } from "../zones/counter.ts";
import { discardCard } from "../zones/discard.ts";
import { drawCard } from "../zones/draw.ts";
import { moveCard } from "../zones/move-card.ts";
import { reorderLibraryTop } from "../zones/reorder-library.ts";
import { reveal } from "../zones/reveal.ts";
import { shuffleLibrary } from "../zones/shuffle.ts";
import { ceaseToExist, createToken } from "../zones/tokens.ts";
import { type ProposedEvent, playLandDestination, type SingleEvent } from "./proposed.ts";

export function perform(state: GameState, event: ProposedEvent, cards: CardDatabase): Progress {
  const before = snapshots(state, event, cards);
  const done =
    event.kind !== "simultaneous"
      ? performOne(state, event, cards)
      : // All already replaced, so the order matters only to the order of the events and of a graveyard (D-039).
        event.events.reduce<Progress>((p, e) => andThen(p, (s) => performOne(s, e, cards)), { state, events: [] });
  return { state: keepLastKnown(state, done.state, before), events: done.events };
}

/**
 * The computed characteristics of each permanent the event may move off the battlefield, taken before any of it
 * happens: what a permanent that leaves was as it last existed (CR 608.2h), all of a simultaneous batch from the same
 * moment (state-based actions too, CR 704.8), so an Awakener Druid leaving first doesn't make its Forest leave as a
 * mere land.
 */
function snapshots(
  state: GameState,
  event: ProposedEvent,
  cards: CardDatabase,
): Record<ObjectId, LastKnownCharacteristics> {
  const events = event.kind === "simultaneous" ? event.events : [event];
  const ids = events.flatMap(leavingObjects).filter((id) => state.zones.battlefield.includes(id));
  return Object.fromEntries(ids.map((id) => [id, lastKnownOf(characteristics(state, id, cards))]));
}

/** The objects an event may move off the battlefield; each new kind of event says whether it does. */
function leavingObjects(event: SingleEvent): ObjectId[] {
  switch (event.kind) {
    case "moveCard":
    case "destroy":
    case "sacrifice":
      return [event.object];
    // A spell countered or a card discarded isn't a permanent; a land played comes onto the battlefield.
    case "counterObject":
    case "discard":
    case "playLand":
    case "regenerate":
    case "damagePrevented":
    case "dealDamage":
    case "reveal":
    case "reorderLibrary":
    case "tap":
    case "untap":
    case "putCounters":
    case "removeCounters":
    case "createToken":
    // A token leaves the game from a zone that isn't the battlefield (CR 111.7).
    case "ceaseToExist":
    case "gainLife":
    case "loseLife":
    case "addMana":
    case "draw":
    case "shuffle":
      return [];
  }
}

function lastKnownOf(c: Characteristics): LastKnownCharacteristics {
  const { controller, power, toughness } = c;
  return {
    controller,
    types: [...c.types],
    subtypes: [...c.subtypes],
    colors: [...c.colors],
    power,
    toughness,
    keywords: [...c.keywords],
  };
}

/**
 * Keeps the snapshots of those that left the battlefield, and the objects as they were before the event too: a batch
 * that also removed counters (CR 704.5q beside 704.5f) left them as they last existed then, not after (CR 704.3).
 */
function keepLastKnown(
  before: GameState,
  state: GameState,
  taken: Record<ObjectId, LastKnownCharacteristics>,
): GameState {
  const left = (Object.keys(taken) as ObjectId[]).filter((id) => !state.zones.battlefield.includes(id));
  if (left.length === 0) return state;
  const objects = left.flatMap((id) => {
    const obj = before.objects[id];
    return obj?.kind === "card" ? [[id, obj] as const] : [];
  });
  return {
    ...state,
    lastKnown: { ...state.lastKnown, ...Object.fromEntries(objects) },
    lastKnownCharacteristics: {
      ...state.lastKnownCharacteristics,
      ...Object.fromEntries(left.map((id) => [id, taken[id]])),
    },
  };
}

function performOne(state: GameState, event: SingleEvent, cards: CardDatabase): Progress {
  switch (event.kind) {
    case "moveCard": {
      // Callers read the new object from the `ZONE_CHANGED` event (`zoneChangeOf`), not from `newId`: a replacement
      // may have moved the card somewhere else.
      const { state: moved, events } = moveCard(state, event.object, event.to);
      return { state: moved, events };
    }
    case "destroy":
      return destroy(state, event.object, event.to);
    case "regenerate":
      return regenerate(state, event.object);
    case "damagePrevented":
      // Nothing changes: the damage is never dealt (CR 615.6). The event only tells what prevented it.
      return {
        state,
        events: [{ type: "DAMAGE_PREVENTED", source: event.source, to: event.to, amount: event.amount, by: event.by }],
      };
    case "sacrifice":
      return sacrifice(state, event.object, event.to);
    case "dealDamage":
      return dealDamage(state, event.damage, cards);
    case "reveal":
      return reveal(state, event.from, event.objects);
    case "reorderLibrary":
      return reorderLibraryTop(state, event.player, event.top);
    case "tap":
      return tapPermanent(state, event.object);
    case "counterObject":
      return counterObject(state, event.object, event.to);
    case "gainLife":
      return gainLife(state, event.player, event.amount);
    case "loseLife":
      return loseLife(state, event.player, event.amount);
    case "untap":
      return untapPermanent(state, event.object);
    case "putCounters":
      return putCounters(state, event.object, event.counter, event.amount);
    case "removeCounters":
      return removeCounters(state, event.object, event.counter, event.amount);
    case "createToken":
      return createToken(state, event.token, event.player);
    case "ceaseToExist":
      return ceaseToExist(state, event.object);
    case "addMana":
      return addMana(state, event.player, event.mana, event.amount, event.source);
    case "draw":
      return drawCard(state, event.player);
    case "discard":
      return discardCard(state, event.object, event.to);
    case "shuffle":
      return shuffleLibrary(state, event.player);
    case "playLand": {
      const moved = moveCard(state, event.object, playLandDestination(event));
      return andThen(moved, (s) => countLandPlay(s, event.player, moved.newId));
    }
  }
}
