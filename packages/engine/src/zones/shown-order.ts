// The order cards are shown in when a player sees them outside their usual view: a revealed hand, a searched library,
// the options of a `chooseCards` decision (D-062).

import { textOracleId } from "../cards/card-data.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, OracleId } from "../state/ids.ts";
import { isHiddenZone } from "./move-card.ts";
import { zoneOf } from "./zone-list.ts";

/**
 * Sorted by oracle id, then by object id. A hand's or library's own order, like an object id, records how the cards
 * got there (which was drawn on which turn), so it must not leak; this order depends only on which cards there are.
 * Ties between copies of one card are broken by object id, which no one is shown. Plain code-unit comparison, the same
 * on every machine, as replays depend on it.
 */
export function inShownOrder(state: GameState, ids: readonly ObjectId[]): ObjectId[] {
  return [...ids].sort((a, b) => {
    const [x, y] = [oracleIdOf(state, a), oracleIdOf(state, b)];
    if (x !== y) return x < y ? -1 : 1;
    // Object ids are `o` and a number (state/ids.ts): compare the numbers, so o9 comes before o10.
    return Number(a.slice(1)) - Number(b.slice(1));
  });
}

/**
 * What a card is, as shown: the copied card for a permanent that's a copy (CR 707.2; only one on the battlefield is).
 * Only cards are ever shown this way, so anything else is an engine bug.
 */
export function oracleIdOf(state: GameState, id: ObjectId): OracleId {
  const obj = state.objects[id];
  if (obj?.kind !== "card") throw new Error(`${id} isn't a card`);
  return textOracleId(obj);
}

/**
 * An object's id for an event every player is shown, or null while it's in a hidden zone (a card about to enter from a
 * library or hand): its id there records how it got there (D-062).
 */
export function publicIdOf(state: GameState, id: ObjectId): ObjectId | null {
  return isHiddenZone(zoneOf(state, id)) ? null : id;
}
