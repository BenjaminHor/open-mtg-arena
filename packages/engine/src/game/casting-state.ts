// The cast or activation in progress (`GameState.casting`, CR 601.2, 602.2b).

import type { Casting } from "../state/casting.ts";
import type { GameState } from "../state/game-state.ts";

export function castingOf(state: GameState): Casting {
  if (state.casting === null) throw new Error("Nothing is being cast or activated");
  return state.casting;
}
