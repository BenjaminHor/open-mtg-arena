// "Put it into your hand", "onto the battlefield", "on the bottom of your library": moving the cards an effect names,
// such as the cards a search found or a revealed card (CR 608.2c), to the zone the text says.

import type { CardDatabase, Effect } from "../cards/types.ts";
import { waitFor } from "../game/decide.ts";
import type { Progress } from "../game/progress.ts";
import { happen } from "../pipeline/happen.ts";
import { matchesFilter } from "../rules/object-filter.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { Destination } from "../zones/move-card.ts";
import { zoneOf } from "../zones/zone-list.ts";
import { objectsNamed, onePlayer } from "./subjects.ts";

type Put = Extract<Effect, { op: "put" }>;

/**
 * Puts the named cards that are still where they were, and fit `onlyIf` ("if it's a creature card"), where the effect
 * says. "You may put" asks the controller first, and only if there's a card to put (CR 608.2d), unless the cards are in
 * a hidden zone: then it's asked even when none fits, with yes impossible, as asking only when one fits would tell the
 * other players what the unrevealed card is (CR 701.23e; Sphinx Ambassador's ruling; D-062, D-121).
 */
export function put(state: GameState, effect: Put, context: EffectContext, cards: CardDatabase): Progress {
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
  // One card on top of the library it's already in isn't a zone change (CR 400.7): the same object, moved up
  // (Liliana Vess). Moving several, or from elsewhere, is a move.
  const [only, ...more] = ids;
  const from = only === undefined ? null : zoneOf(state, only);
  if (effect.into === "libraryTop" && more.length === 0 && from?.zone === "library" && "player" in from)
    return happen(state, { kind: "reorderLibrary", player: from.player, top: ids }, cards);
  const to = destinationOf(effect, by, context);
  return happen(
    state,
    { kind: "simultaneous", events: ids.map((object) => ({ kind: "moveCard", object, to })) },
    cards,
  );
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
