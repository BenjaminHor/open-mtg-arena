// Effects that choose cards from a hand (M2-05b2a): discarding cards a player chooses, revealing a hand, putting a card
// from a hand onto the battlefield. Each asks with `askToChoose` and runs again with the cards chosen.

import type { CardDatabase, Effect, ObjectFilter } from "../cards/types.ts";
import type { Progress } from "../game/progress.ts";
import { happen } from "../pipeline/happen.ts";
import { matchesFilter } from "../rules/object-filter.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { zoneList } from "../zones/zone-list.ts";
import { askToChoose } from "./choose-cards.ts";

type Discard = Extract<Effect, { op: "discard" }>;
type PutOntoBattlefield = Extract<Effect, { op: "putOntoBattlefield" }>;

const nothing = (state: GameState): Progress => ({ state, events: [] });

/**
 * `player` discards `amount` cards (CR 701.9a), chosen by them (CR 701.9b) or by "you", among the cards fitting the
 * effect's filter; fewer if there aren't enough, as much as possible (CR 609.3). When every card in the hand must go,
 * there's nothing to choose: the hand's size is public (CR 402.3), so not asking tells no one anything. Otherwise
 * the choice is mandatory (CR 608.2d). The chosen cards are discarded together.
 */
export function discardChosen(
  state: GameState,
  player: PlayerId,
  amount: number,
  effect: Discard,
  context: EffectContext,
  chosen: readonly ObjectId[] | null,
  cards: CardDatabase,
): Progress {
  const hand = zoneList(state, { zone: "hand", player });
  if (chosen !== null)
    return discardAll(
      state,
      chosen.filter((id) => hand.includes(id)),
      cards,
    );
  const fitting = fittingCards(state, hand, effect.filter, context.controller, cards);
  const count = Math.min(Math.max(0, amount), fitting.length);
  if (count === 0) return nothing(state);
  if (count === hand.length) return discardAll(state, hand, cards);
  const chooser = effect.chosenBy === "you" ? context.controller : player;
  return nothing(
    askToChoose(state, { chooser, purpose: "discard", options: fitting, min: count, max: count, effect, context }),
  );
}

/** Shows `player`'s hand to every player (CR 701.20a), even an empty one; it stays in the hand (CR 701.20b). */
export function revealHand(state: GameState, player: PlayerId, cards: CardDatabase): Progress {
  const from = { zone: "hand", player } as const;
  return happen(state, { kind: "reveal", from, objects: [...zoneList(state, from)] }, cards);
}

/**
 * "You may put a [filter] card from your hand onto the battlefield": it enters under the controller's control
 * (CR 110.2a); it isn't cast. Asked whenever the hand has cards, even if none fits: the hand is hidden, so skipping
 * the choice would tell the other players it holds no such card (D-062). An empty hand is public (CR 402.3).
 */
export function putOntoBattlefieldFromHand(
  state: GameState,
  effect: PutOntoBattlefield,
  context: EffectContext,
  chosen: readonly ObjectId[] | null,
  cards: CardDatabase,
): Progress {
  const controller = context.controller;
  const hand = zoneList(state, { zone: "hand", player: controller });
  if (chosen !== null) {
    const moves = chosen
      .filter((id) => hand.includes(id))
      .map((object) => ({ kind: "moveCard", object, to: { zone: "battlefield", controller } }) as const);
    return moves.length === 0 ? nothing(state) : happen(state, { kind: "simultaneous", events: moves }, cards);
  }
  if (hand.length === 0) return nothing(state);
  const options = fittingCards(state, hand, effect.filter, controller, cards);
  const min = effect.optional ? 0 : Math.min(1, options.length);
  return nothing(
    askToChoose(state, { chooser: controller, purpose: "putOntoBattlefield", options, min, max: 1, effect, context }),
  );
}

function discardAll(state: GameState, ids: readonly ObjectId[], cards: CardDatabase): Progress {
  if (ids.length === 0) return nothing(state);
  return happen(
    state,
    { kind: "simultaneous", events: ids.map((object) => ({ kind: "discard", object }) as const) },
    cards,
  );
}

function fittingCards(
  state: GameState,
  ids: readonly ObjectId[],
  filter: ObjectFilter | undefined,
  you: PlayerId,
  cards: CardDatabase,
): ObjectId[] {
  return filter === undefined ? [...ids] : ids.filter((id) => matchesFilter(state, id, filter, you, cards));
}
