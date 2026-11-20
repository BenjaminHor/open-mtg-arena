// The order cards are shown in when a player sees them outside their usual view: a revealed hand, a searched library,
// the options of a `chooseCards` decision (D-062).

import type { GameState } from "../state/game-state.ts";
import type { ObjectId, OracleId } from "../state/ids.ts";

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

/** What a card is. Only cards are ever shown this way, so anything else is an engine bug. */
export function oracleIdOf(state: GameState, id: ObjectId): OracleId {
  // A card that left is named as it last existed (a source chosen after it was bounced, CR 609.7a).
  const obj = state.objects[id] ?? state.lastKnown[id];
  if (obj?.kind !== "card") throw new Error(`${id} isn't a card`);
  return obj.oracleId;
}
