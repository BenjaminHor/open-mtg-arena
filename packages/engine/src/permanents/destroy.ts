// Destroying a permanent (CR 701.8). Its own function, so regeneration (CR 701.19), which replaces "destroy" and not
// other ways of going to the graveyard, has one place to plug in. Indestructible (later: CR 702.12b) belongs elsewhere too:
// an indestructible creature ignores the lethal-damage state-based action, so `rules/state-based-actions.ts` must not
// list it. Listing it and doing nothing here would make the check "perform" it forever.

import type { Progress } from "../game/progress.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import { moveCard } from "../zones/move-card.ts";

/** Moves a permanent from the battlefield to its owner's graveyard (CR 701.8a), emitting `PERMANENT_DESTROYED`. */
export function destroy(state: GameState, id: ObjectId): Progress {
  const obj = state.objects[id];
  if (obj?.kind !== "card" || !state.zones.battlefield.includes(id)) throw new Error(`${id} isn't a permanent`);
  const moved = moveCard(state, id, { zone: "graveyard" });
  return {
    state: moved.state,
    events: [{ type: "PERMANENT_DESTROYED", object: id, cardId: obj.cardId }, ...moved.events],
  };
}
