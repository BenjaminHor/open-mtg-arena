// Who can be dealt damage (CR 120.1a).

import type { CardDatabase } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { Target } from "../state/objects.ts";
import { cardTypesOf } from "./card-types.ts";

/**
 * Whether the recipient can be dealt damage: a player, or a creature or planeswalker on the battlefield (CR 120.1a;
 * battles, later: CR 310). A recipient that left between the start of resolution and this effect is a new object
 * (CR 400.7), so dealing it damage is impossible and is ignored (CR 101.3).
 */
export function canBeDealtDamage(state: GameState, to: Target, cards: CardDatabase): boolean {
  switch (to.kind) {
    case "player":
      return state.players[to.player] !== undefined;
    case "object": {
      if (!state.zones.battlefield.includes(to.object)) return false;
      const types = cardTypesOf(state, to.object, cards);
      return types.includes("creature") || types.includes("planeswalker");
    }
  }
}
