// The order cards are shown in when a player sees them outside their usual view: a revealed hand, a searched library,
// the options of a `chooseCards` decision (D-062).

import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";

/**
 * Sorted by oracle id, then by object id. A hand's or library's own order, like an object id, records how the cards
 * got there (which was drawn on which turn), so it must not leak; this order depends only on which cards there are.
 * Ties between copies of one card are broken by object id, which no one is shown. Plain code-unit comparison, the same
 * on every machine, as replays depend on it.
 */
export function inShownOrder(state: GameState, ids: readonly ObjectId[]): ObjectId[] {
  const oracle = (id: ObjectId) => {
    const obj = state.objects[id];
    return obj?.kind === "card" ? obj.oracleId : "";
  };
  return [...ids].sort((a, b) => {
    const [x, y] = [oracle(a), oracle(b)];
    if (x !== y) return x < y ? -1 : 1;
    return Number(a.slice(1)) - Number(b.slice(1));
  });
}
