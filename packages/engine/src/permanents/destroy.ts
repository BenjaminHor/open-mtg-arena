// Destroying a permanent (CR 701.8). Its own event, so regeneration (later: CR 701.19), which replaces "destroy" and
// not other ways of going to the graveyard, has one place to plug in. Indestructible (CR 702.12b) is handled before:
// `pipeline/replacements.ts` drops a destroy it ignores, and `rules/state-based-actions.ts` doesn't list the
// lethal-damage and deathtouch actions for it (listing them would make the check "perform" them forever).

import type { Progress } from "../game/progress.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import { type Destination, moveCard } from "../zones/move-card.ts";

/**
 * Moves a permanent from the battlefield to its owner's graveyard (CR 701.8a), or where a replacement sends it, emitting
 * `PERMANENT_DESTROYED`.
 */
export function destroy(state: GameState, id: ObjectId, to: Destination = { zone: "graveyard" }): Progress {
  const obj = state.objects[id];
  if (obj?.kind !== "card" || !state.zones.battlefield.includes(id)) throw new Error(`${id} isn't a permanent`);
  const moved = moveCard(state, id, to);
  return {
    state: moved.state,
    events: [{ type: "PERMANENT_DESTROYED", object: id, cardId: obj.cardId }, ...moved.events],
  };
}
