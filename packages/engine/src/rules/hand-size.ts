// A player's maximum hand size (CR 402.2): seven, a different rule from the starting hand size though both are normally
// seven. "You have no maximum hand size" (Spellbook) removes it while its permanent is on the battlefield under that
// player's control. Effects that set another number (later: CR 402.2, Null Profusion) would apply in timestamp order.

import type { CardDatabase } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";
import { staticAbilitiesOf } from "./abilities.ts";
import { controllerOf } from "./controller.ts";

export const MAXIMUM_HAND_SIZE = 7;

/** The player's maximum hand size now, or null if they have none. */
export function maximumHandSize(state: GameState, player: PlayerId, cards: CardDatabase): number | null {
  const unlimited = state.zones.battlefield.some(
    (id) =>
      controllerOf(state, id) === player &&
      staticAbilitiesOf(state, id, cards).some((a) => a.kind === "noMaximumHandSize"),
  );
  return unlimited ? null : MAXIMUM_HAND_SIZE;
}
