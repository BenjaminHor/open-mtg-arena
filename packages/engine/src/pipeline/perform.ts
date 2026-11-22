// Performing an event, after replacement effects have had their say: the one place that calls the primitives that
// change the game (only-the-pipeline-performs.test.ts checks it).

import type { CardDatabase } from "../cards/types.ts";
import { dealDamage } from "../effects/deal-damage.ts";
import { gainLife, loseLife } from "../effects/life.ts";
import { countLandPlay } from "../game/land-played.ts";
import { andThen, type Progress } from "../game/progress.ts";
import { addMana } from "../mana/pool.ts";
import { attach, unattach } from "../permanents/attach.ts";
import { putCounters, removeCounters } from "../permanents/counters.ts";
import { destroy } from "../permanents/destroy.ts";
import { regenerate } from "../permanents/regenerate.ts";
import { sacrifice } from "../permanents/sacrifice.ts";
import { tapPermanent } from "../permanents/tap.ts";
import { untapPermanent } from "../permanents/untap.ts";
import { type Characteristics, characteristics } from "../rules/characteristics.ts";
import { libraryTopsRevealed } from "../rules/revealed.ts";
import type { GameEvent } from "../state/events.ts";
import type { GameState, LastKnownCharacteristics } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { counterObject } from "../zones/counter.ts";
import { discardCard } from "../zones/discard.ts";
import { drawCard } from "../zones/draw.ts";
import { moveCard } from "../zones/move-card.ts";
import { reorderLibrary } from "../zones/reorder-library.ts";
import { reveal } from "../zones/reveal.ts";
import { shuffleLibrary } from "../zones/shuffle.ts";
import { putSpellCopy } from "../zones/spell-copies.ts";
import { ceaseToExist, createToken } from "../zones/tokens.ts";
import { zoneChangeOf } from "./moved.ts";
import { type ProposedEvent, playLandDestination, type SingleEvent } from "./proposed.ts";

export function perform(state: GameState, event: ProposedEvent, cards: CardDatabase): Progress {
  const before = snapshots(state, event, cards);
  const done =
    event.kind !== "simultaneous"
      ? performOne(state, event, cards)
      : // All already replaced, so the order matters only to the order of the events and of a graveyard (D-039).
        event.events.reduce<Progress>((p, e) => andThen(p, (s) => performOne(s, renamed(e, p.events), cards)), {
          state,
          events: [],
        });
  return withNewTopsShown(
    state,
    event,
    { state: keepLastKnown(state, done.state, before), events: done.events },
    cards,
  );
}

/**
 * A library's top card played revealed (Vampire Nocturnus) is seen by everyone as soon as it's the top, also for a
 * moment within one resolution, between a search taking the top card and the shuffle after it, or between two draws
 * (the card's ruling: "reveal each one before you draw it"). A view comes only between actions, so each new top is
 * told with `CARDS_REVEALED` after the event that made it the top: a simultaneous batch is one event, and shows only
 * the top it leaves. But a top changed while a spell is being cast waits until it's cast (CR 401.5): a card moving to
 * the stack is being cast (CR 601.2a), and its cast tells the new top once it's done (`payCost`).
 */
function withNewTopsShown(before: GameState, event: ProposedEvent, after: Progress, cards: CardDatabase): Progress {
  if (isCast(event)) return after;
  const topOf = (s: GameState, p: PlayerId) => s.zones.players[p]?.library[0];
  const changed = after.state.turnOrder.filter((p) => topOf(before, p) !== topOf(after.state, p));
  if (changed.length === 0) return after;
  const revealed = libraryTopsRevealed(after.state, cards);
  const shown = changed.flatMap((player) => {
    const top = topOf(after.state, player);
    return top === undefined || !revealed.includes(player)
      ? []
      : reveal(after.state, { zone: "library", player }, [top]).events;
  });
  return { state: after.state, events: [...after.events, ...shown] };
}

/**
 * A reorder, or a token ceasing to exist, in a batch names cards by the ids they had as the batch was proposed: those
 * moved earlier in it (several cards put on top of a library and then arranged, CR 401.4) are new objects (CR 400.7),
 * named by their new ids.
 */
function renamed(event: SingleEvent, earlier: readonly GameEvent[]): SingleEvent {
  const newId = (id: ObjectId) => zoneChangeOf(earlier, id)?.newId ?? id;
  switch (event.kind) {
    case "reorderLibrary":
      return event.bottom === undefined
        ? { ...event, top: event.top.map(newId) }
        : { ...event, top: event.top.map(newId), bottom: event.bottom.map(newId) };
    // A token moved earlier in the batch, gone as it ends (Warp World: "you shouldn't actually shuffle them in").
    case "ceaseToExist":
      return { ...event, object: newId(event.object) };
    // No batch yet names an object it moved earlier in these: each new one says whether it can.
    case "moveCard":
    case "destroy":
    case "regenerate":
    case "damagePrevented":
    case "sacrifice":
    case "dealDamage":
    case "counterObject":
    case "gainLife":
    case "loseLife":
    case "reveal":
    case "tap":
    case "untap":
    case "putCounters":
    case "removeCounters":
    case "attach":
    case "unattach":
    case "createToken":
    case "copySpell":
    case "addMana":
    case "draw":
    case "discard":
    case "shuffle":
    case "playLand":
      return event;
  }
}

/** A card moving to the stack: the first step of casting it (CR 601.2a). */
function isCast(event: ProposedEvent): boolean {
  return event.kind === "moveCard" && event.to.zone === "stack";
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
    case "copySpell":
    case "attach":
    case "unattach":
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
      return sacrifice(state, event.object, cards, event.to);
    case "dealDamage":
      return dealDamage(state, event.damage, cards);
    case "reveal":
      return reveal(state, event.from, event.objects);
    case "reorderLibrary":
      return reorderLibrary(state, event.player, event.top, event.bottom);
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
    case "copySpell":
      return putSpellCopy(state, event.player, event.spell);
    case "attach":
      return attach(state, event.object, event.to);
    case "unattach":
      return unattach(state, event.object);
    case "ceaseToExist":
      return ceaseToExist(state, event.object);
    case "addMana":
      return addMana(state, event.player, event.mana, event.amount, event.source);
    case "draw":
      return drawCard(state, event.player);
    case "discard":
      return discardCard(state, event.object, event.to);
    case "shuffle": {
      const shuffled = shuffleLibrary(state, event.player);
      const onTop = event.thenOnTop;
      return onTop === undefined ? shuffled : andThen(shuffled, (s) => reorderLibrary(s, event.player, onTop));
    }
    case "playLand": {
      const moved = moveCard(state, event.object, playLandDestination(event));
      return andThen(moved, (s) => countLandPlay(s, event.player, moved.newId));
    }
  }
}
