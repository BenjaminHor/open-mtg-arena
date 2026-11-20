// Performing an event, after replacement effects have had their say: the one place that calls the primitives that
// change the game (only-the-pipeline-performs.test.ts checks it).

import type { CardDatabase } from "../cards/types.ts";
import { dealDamage } from "../effects/deal-damage.ts";
import { gainLife, loseLife } from "../effects/life.ts";
import { countLandPlay } from "../game/land-played.ts";
import { andThen, type Progress } from "../game/progress.ts";
import { addMana } from "../mana/pool.ts";
import { destroy } from "../permanents/destroy.ts";
import { sacrifice } from "../permanents/sacrifice.ts";
import { tapPermanent } from "../permanents/tap.ts";
import { untapPermanent } from "../permanents/untap.ts";
import type { GameState } from "../state/game-state.ts";
import { counterObject } from "../zones/counter.ts";
import { discardCard } from "../zones/discard.ts";
import { drawCard } from "../zones/draw.ts";
import { moveCard } from "../zones/move-card.ts";
import { reorderLibraryTop } from "../zones/reorder-library.ts";
import { reveal } from "../zones/reveal.ts";
import { shuffleLibrary } from "../zones/shuffle.ts";
import { type ProposedEvent, playLandDestination, type SingleEvent } from "./proposed.ts";

export function perform(state: GameState, event: ProposedEvent, cards: CardDatabase): Progress {
  if (event.kind !== "simultaneous") return performOne(state, event, cards);
  // All already replaced, so the order matters only to the order of the events and of a graveyard (D-039).
  return event.events.reduce<Progress>((p, e) => andThen(p, (s) => performOne(s, e, cards)), { state, events: [] });
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
