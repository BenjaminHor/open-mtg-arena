// "Put it into your hand", "onto the battlefield", "on the bottom of your library": moving the cards an effect names,
// such as the cards a search found or a revealed card (CR 608.2c), to the zone the text says.

import type { CardDatabase, Effect } from "../cards/types.ts";
import { waitFor } from "../game/decide.ts";
import type { Progress } from "../game/progress.ts";
import { happen } from "../pipeline/happen.ts";
import { matchesFilter } from "../rules/object-filter.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";
import type { Destination } from "../zones/move-card.ts";
import { zoneOf } from "../zones/zone-list.ts";
import { objectsNamed, onePlayer } from "./subjects.ts";

type Put = Extract<Effect, { op: "put" }>;

/**
 * Puts the named cards that are still where they were, and fit `onlyIf` ("if it's a creature card"), where the effect
 * says. "You may put" asks the controller first, and only if there's a card to put (CR 608.2d).
 */
export function put(state: GameState, effect: Put, context: EffectContext, cards: CardDatabase): Progress {
  const ids = objectsNamed(state, effect.of, context, cards).filter(
    (id) =>
      state.objects[id] !== undefined &&
      (effect.onlyIf === undefined || matchesFilter(state, id, effect.onlyIf, context.controller, cards)),
  );
  if (ids.length === 0) return { state, events: [] };
  if (effect.optional === true) {
    const { optional: _, ...always } = effect;
    const resume = [{ kind: "runEffect", effect: always, context, chosen: null } as const];
    const asked = waitFor(state, context.controller, { kind: "chooseYesNo", purpose: "optional", resume });
    return { state: asked, events: [] };
  }
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
