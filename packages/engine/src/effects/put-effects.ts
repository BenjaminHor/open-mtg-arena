// "Put it into your hand", "onto the battlefield", "on the bottom of your library": moving the cards an effect names,
// such as the cards a search found or a revealed card (CR 608.2c), to the zone the text says. Several cards put on top
// of a library are arranged by their owner, unrevealed (CR 401.4).

import { textOracleId } from "../cards/card-data.ts";
import type { CardDatabase, Effect } from "../cards/types.ts";
import { waitFor } from "../game/decide.ts";
import { andThen, type Progress } from "../game/progress.ts";
import { apnapOrder } from "../game/turn-order.ts";
import { happen, happenOrAsk } from "../pipeline/happen.ts";
import type { SingleEvent } from "../pipeline/proposed.ts";
import { matchesFilter } from "../rules/object-filter.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { Destination } from "../zones/move-card.ts";
import { inShownOrder } from "../zones/shown-order.ts";
import { zoneOf } from "../zones/zone-list.ts";
import { askToChoose } from "./choose-cards.ts";
import { objectsNamed, onePlayer } from "./subjects.ts";

type Put = Extract<Effect, { op: "put" }>;

/**
 * Puts the named cards that are still where they were, and fit `onlyIf` ("if it's a creature card"), where the effect
 * says. "You may put" asks the controller first, and only if there's a card to put (CR 608.2d), unless the cards are in
 * a hidden zone: then it's asked even when none fits, with yes impossible, as asking only when one fits would tell the
 * other players what the unrevealed card is (CR 701.23e; Sphinx Ambassador's ruling; D-062, D-121).
 */
export function put(
  state: GameState,
  effect: Put,
  context: EffectContext,
  chosen: readonly ObjectId[] | null,
  cards: CardDatabase,
): Progress {
  const named = objectsNamed(state, effect.of, context, cards).filter((id) => state.objects[id] !== undefined);
  const ids = named.filter(
    (id) => effect.onlyIf === undefined || matchesFilter(state, id, effect.onlyIf, context.controller, cards),
  );
  if (effect.optional === true) {
    const hidden = named.some((id) => isHidden(state, id));
    if (ids.length === 0 && !hidden) return { state, events: [] };
    const { optional: _, ...always } = effect;
    const resume = ids.length === 0 ? [] : [{ kind: "runEffect", effect: always, context, chosen: null } as const];
    const decision = { kind: "chooseYesNo", purpose: "optional", canSayYes: ids.length > 0, resume } as const;
    return { state: waitFor(state, context.controller, decision), events: [] };
  }
  if (ids.length === 0) return { state, events: [] };
  // "The player puts that card onto the battlefield": that player controls it (CR 110.2a).
  // If no such player is left, no one puts it anywhere.
  const by = effect.by === undefined ? context.controller : onePlayer(state, effect.by, context, cards);
  if (by === null) return { state, events: [] };
  if (effect.into === "libraryTop" || effect.into === "libraryBottom")
    return putInLibraries(state, ids, effect.into === "libraryTop" ? "top" : "bottom", effect, context, chosen, cards);
  const to = destinationOf(effect, by, context);
  // The last thing this effect does, so a permanent entering may stop to make its choice as it enters (CR 614.12a; a
  // Clone risen from a graveyard chooses what to copy).
  return happenOrAsk(
    state,
    { kind: "simultaneous", events: ids.map((object) => ({ kind: "moveCard", object, to })) },
    cards,
  );
}

/**
 * Cards put on top or on the bottom of their owners' libraries (CR 400.3). Several at once are arranged by their owner
 * (CR 401.4), a choice top first, asked of each owner in turn order from the active player (CR 101.4), and the order
 * isn't revealed: cards from elsewhere move in shown order (D-062), then the library is reordered, which no event shows,
 * in one batch, so a top played revealed is shown only as it ends (Vampire Nocturnus). A card already in that library
 * isn't a new object (CR 400.7): it's only reordered (Liliana Vess, Lurking Predators, Warp World's revealed cards).
 * Copies of one card need no arranging: no one could tell them apart. With `chosen`, the answer is its owner's order;
 * the owners after them follow.
 */
function putInLibraries(
  state: GameState,
  ids: readonly ObjectId[],
  position: "top" | "bottom",
  effect: Put,
  context: EffectContext,
  chosen: readonly ObjectId[] | null,
  cards: CardDatabase,
): Progress {
  const objects = ids.flatMap((id) => (state.objects[id]?.kind === "card" ? [state.objects[id]] : []));
  if (objects.length !== ids.length) throw new Error("only cards are put into a library");
  const owners = apnapOrder(state).flatMap((owner) => {
    const theirs = objects.filter((o) => o.owner === owner);
    return theirs.length === 0 ? [] : [{ owner, cards: theirs }];
  });
  const answered = chosen === null ? -1 : owners.findIndex((o) => o.cards.some((c) => c.id === chosen[0]));
  let progress: Progress = { state, events: [] };
  for (const [i, { owner, cards: theirs }] of owners.entries()) {
    if (i < answered) continue;
    const [first] = theirs;
    const alike = theirs.every((o) => first !== undefined && textOracleId(o) === textOracleId(first));
    const order = i === answered && chosen !== null ? chosen : alike ? theirs.map((o) => o.id) : null;
    if (order === null) {
      const options = theirs.map((o) => o.id);
      const count = options.length;
      const purpose = position === "top" ? "putOnTop" : "putOnBottom";
      const ask = askToChoose(progress.state, {
        chooser: owner,
        purpose,
        options,
        min: count,
        max: count,
        effect,
        context,
      });
      return { state: ask, events: progress.events };
    }
    progress = andThen(progress, (s) => arrange(s, owner, order, position, cards));
  }
  return progress;
}

/** `order`, top first, put at that end of `owner`'s library in one batch: moved there if it isn't, then arranged. */
function arrange(
  state: GameState,
  owner: PlayerId,
  order: readonly ObjectId[],
  position: "top" | "bottom",
  cards: CardDatabase,
): Progress {
  const library = state.zones.players[owner]?.library ?? [];
  const to = { zone: "library", position } as const;
  const moving = inShownOrder(
    state,
    order.filter((id) => !library.includes(id)),
  );
  const moves = moving.map((object): SingleEvent => ({ kind: "moveCard", object, to }));
  const arranged: SingleEvent =
    position === "top"
      ? { kind: "reorderLibrary", player: owner, top: [...order] }
      : { kind: "reorderLibrary", player: owner, top: [], bottom: [...order] };
  return happen(state, { kind: "simultaneous", events: [...moves, arranged] }, cards);
}

/** Whether the card is in a zone not every player sees into: a library or a hand (CR 400.2). */
function isHidden(state: GameState, id: ObjectId): boolean {
  const zone = zoneOf(state, id).zone;
  return zone === "library" || zone === "hand";
}

/**
 * Where "put" takes a card: its owner's hand or library (CR 400.3), or the battlefield under the controller (CR 110.2a),
 * with what it is as it enters, an effect of this spell or ability (CR 611.2e).
 */
function destinationOf(effect: Put, controller: PlayerId, context: EffectContext): Destination {
  switch (effect.into) {
    case "hand":
      return { zone: "hand" };
    case "libraryTop":
      return { zone: "library", position: "top" };
    case "libraryBottom":
      return { zone: "library", position: "bottom" };
    case "battlefield": {
      const is =
        effect.is === undefined
          ? {}
          : { is: { source: context.self, controller: context.controller, change: effect.is } };
      return effect.tapped === true
        ? { zone: "battlefield", controller, tapped: true, ...is }
        : { zone: "battlefield", controller, ...is };
    }
  }
}
