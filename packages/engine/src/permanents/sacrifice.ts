// Sacrificing a permanent (CR 701.21a): its controller moves it from the battlefield to its owner's graveyard. It isn't
// destroyed, so regeneration and other effects that replace destruction can't affect it. A creature sacrificed dies
// (CR 700.4), as "when this creature dies" sees.

import type { CardDatabase } from "../cards/types.ts";
import type { Progress } from "../game/progress.ts";
import { controllerOf } from "../rules/controller.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import { type Destination, moveCard } from "../zones/move-card.ts";

/**
 * Moves the permanent to its owner's graveyard, or where a replacement sends it, emitting `PERMANENT_SACRIFICED` (with
 * who sacrificed it) first.
 */
export function sacrifice(
  state: GameState,
  id: ObjectId,
  cards: CardDatabase,
  to: Destination = { zone: "graveyard" },
): Progress {
  const obj = state.objects[id];
  if (obj?.kind !== "card" || !state.zones.battlefield.includes(id)) throw new Error(`${id} isn't a permanent`);
  const sacrificed = {
    type: "PERMANENT_SACRIFICED",
    object: id,
    cardId: obj.cardId,
    player: controllerOf(state, id, cards),
  } as const;
  const moved = moveCard(state, id, to);
  return { state: moved.state, events: [sacrificed, ...moved.events] };
}
