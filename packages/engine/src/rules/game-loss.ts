// Whether a player can lose the game now (CR 104.3): "You can't lose the game" (Platinum Angel) stops the state-based
// actions that would make them lose (CR 704.5a-b, 101.2). Conceding isn't stopped (CR 104.3a).

import type { CardDatabase } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";
import { staticAbilitiesOf } from "./abilities.ts";
import { controllerOf } from "./controller.ts";

/** True if a permanent this player controls says they can't lose the game, as its abilities are now (CR 613). */
export function cantLose(state: GameState, player: PlayerId, cards: CardDatabase): boolean {
  return state.zones.battlefield.some(
    (id) =>
      controllerOf(state, id, cards) === player &&
      staticAbilitiesOf(state, id, cards).some((a) => a.kind === "cantLoseOpponentsCantWin"),
  );
}
