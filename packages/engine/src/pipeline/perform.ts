// Performing an event, after replacement effects have had their say: the one place that calls the primitives that
// change the game. Events that lead to other events (destroying a permanent moves it) propose those through `next`, so
// each one gets its own replacement pass (happen.ts).

import type { CardDatabase } from "../cards/types.ts";
import { dealDamage } from "../effects/deal-damage.ts";
import { loseLife } from "../effects/life.ts";
import { andThen, type Progress } from "../game/progress.ts";
import { addMana } from "../mana/pool.ts";
import { markDamage } from "../permanents/damage.ts";
import { destroy } from "../permanents/destroy.ts";
import { tapPermanent } from "../permanents/tap.ts";
import { untapPermanents } from "../permanents/untap.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { discardCards } from "../zones/discard.ts";
import { drawCard } from "../zones/draw.ts";
import { moveCard } from "../zones/move-card.ts";
import { shuffleLibrary } from "../zones/shuffle.ts";
import { zoneChangeOf } from "./moved.ts";
import type { CarryOut, ProposedEvent } from "./proposed.ts";

export function perform(state: GameState, proposed: ProposedEvent, cards: CardDatabase, next: CarryOut): Progress {
  switch (proposed.kind) {
    case "moveCard": {
      const { state: moved, events } = moveCard(state, proposed.object, proposed.to);
      return { state: moved, events };
    }
    case "destroy":
      return destroy(state, proposed.object, next);
    case "dealDamage":
      return dealDamage(state, proposed.damage, cards, next);
    case "loseLife":
      return loseLife(state, proposed.player, proposed.amount);
    case "markDamage":
      return markDamage(state, proposed.object, proposed.amount);
    case "tap":
      return tapPermanent(state, proposed.object);
    case "untap":
      return untapPermanents(state, proposed.objects);
    case "addMana":
      return addMana(state, proposed.player, proposed.mana, proposed.amount, proposed.source);
    case "draw":
      return drawCard(state, proposed.player, next);
    case "discard":
      return discardCards(state, proposed.objects, next);
    case "shuffle":
      return shuffleLibrary(state, proposed.player);
    case "playLand":
      return playLand(state, proposed.player, proposed.object, next);
    case "simultaneous":
      // Performed in the order listed; nothing can observe the order until triggered abilities see the whole batch.
      return proposed.events.reduce<Progress>((p, e) => andThen(p, (s) => next(s, e)), { state, events: [] });
  }
}

/**
 * The land enters the battlefield under the player's control (CR 305.1) and counts toward their lands this turn
 * (CR 305.2). `LAND_PLAYED` follows its zone change.
 */
function playLand(state: GameState, player: PlayerId, object: ObjectId, next: CarryOut): Progress {
  const moved = next(state, { kind: "moveCard", object, to: { zone: "battlefield", controller: player } });
  const ps = moved.state.players[player];
  if (ps === undefined) throw new Error(`No player ${player}`);
  const players = { ...moved.state.players, [player]: { ...ps, landsPlayedThisTurn: ps.landsPlayedThisTurn + 1 } };
  const change = zoneChangeOf(moved.events, object);
  if (change === null) throw new Error(`${object} didn't move`);
  return {
    state: { ...moved.state, players },
    events: [...moved.events, { type: "LAND_PLAYED", player, newId: change.newId, cardId: change.newCardId }],
  };
}
