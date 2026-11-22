// "Each player shuffles all permanents they own into their library" (Warp World): the permanents go to their owners'
// libraries at once (CR 400.3), then each player shuffles (CR 701.24a). How many each player owned is kept for "that
// many cards" (CR 608.2c), counted before anything moved: tokens too, and a permanent another player controls counts
// for its owner (Warp World's rulings).

import type { CardDatabase, Effect } from "../cards/types.ts";
import type { Progress } from "../game/progress.ts";
import { apnapOrder } from "../game/turn-order.ts";
import { happen } from "../pipeline/happen.ts";
import type { SingleEvent } from "../pipeline/proposed.ts";
import { matchesFilter } from "../rules/object-filter.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import { remember } from "./resolution-results.ts";

type ShuffleInto = Extract<Effect, { op: "shuffleIntoLibraries" }>;

/**
 * Every permanent fitting the filter moves to its owner's library, the active player's first, in battlefield order
 * (public, and each library is shuffled after). A token moves too, so what triggers on it leaving does (CR 111.7), and
 * ceases to exist in the same batch: it isn't a card, and its ruling says not to shuffle it in, so no token waits in a
 * library while the rest of the resolution asks its questions. Every player shuffles, one with nothing put in too
 * (CR 701.24d: the library is shuffled even with nothing put in).
 */
export function shuffleIntoLibraries(
  state: GameState,
  effect: ShuffleInto,
  context: EffectContext,
  cards: CardDatabase,
): Progress {
  const fitting = state.zones.battlefield.filter((id) =>
    matchesFilter(state, id, effect.filter, context.controller, cards),
  );
  const ownerOf = (id: ObjectId) => {
    const obj = state.objects[id];
    if (obj?.kind !== "card") throw new Error(`${id} isn't a permanent`);
    return obj.owner;
  };
  const players = apnapOrder(state);
  const shuffledIn = players.map((player) => ({
    player,
    count: fitting.filter((id) => ownerOf(id) === player).length,
  }));
  const moving = players.flatMap((player) => fitting.filter((id) => ownerOf(id) === player));
  const moves = moving.map(
    (object): SingleEvent => ({ kind: "moveCard", object, to: { zone: "library", position: "top" } }),
  );
  const tokens = moving.filter((id) => state.objects[id]?.kind === "card" && state.objects[id].token !== undefined);
  const ceases = tokens.map((object): SingleEvent => ({ kind: "ceaseToExist", object }));
  const shuffles = players.map((player): SingleEvent => ({ kind: "shuffle", player }));
  return happen(
    remember(state, { shuffledIn }),
    { kind: "simultaneous", events: [...moves, ...ceases, ...shuffles] },
    cards,
  );
}
