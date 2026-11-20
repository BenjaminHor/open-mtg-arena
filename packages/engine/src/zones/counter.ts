// Countering a spell or ability (CR 701.6a): it's removed from the stack, doesn't resolve, and none of its effects
// happen. A countered spell goes to its owner's graveyard (CR 404.1) as part of the same event, so a replacement that
// sends it elsewhere sees it (later: CR 614); an ability isn't a card, and ceases to exist. Nothing paid for it comes back
// (CR 701.6b).

import type { Progress } from "../game/progress.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import { moveCard } from "./move-card.ts";
import { removeAbilityFromStack } from "./stack-abilities.ts";

export function counterObject(state: GameState, id: ObjectId): Progress {
  const obj = state.objects[id];
  if (obj === undefined || !state.zones.stack.includes(id)) throw new Error(`${id} isn't on the stack`);
  switch (obj.kind) {
    case "card": {
      const countered = { type: "SPELL_COUNTERED", object: id, cardId: obj.cardId } as const;
      const moved = moveCard(state, id, { zone: "graveyard" });
      return { state: moved.state, events: [countered, ...moved.events] };
    }
    case "ability":
      return {
        state: removeAbilityFromStack(state, id),
        events: [{ type: "ABILITY_COUNTERED", object: id, source: obj.source }],
      };
  }
}
