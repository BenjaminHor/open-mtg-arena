// Revealing cards (CR 701.20a): every player is shown them, and they stay where they are (CR 701.20b).

import type { Progress } from "../game/progress.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import type { ZoneRef } from "../state/zones.ts";
import { inShownOrder } from "./shown-order.ts";

/**
 * Emits `CARDS_REVEALED` with what the cards are, in a fixed order, never their ids (D-062). Nothing in the state
 * changes: a revealed card stays revealed only while its effect needs it (CR 701.20a), which is within one resolution.
 */
export function reveal(state: GameState, from: ZoneRef, ids: readonly ObjectId[]): Progress {
  const cards = inShownOrder(state, ids).flatMap((id) => {
    const obj = state.objects[id];
    return obj?.kind === "card" ? [obj.oracleId] : [];
  });
  return { state, events: [{ type: "CARDS_REVEALED", from, cards }] };
}
