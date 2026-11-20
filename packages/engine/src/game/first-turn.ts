// The starting player takes the first turn (CR 103.8).

import type { CardDatabase } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { Progress } from "./progress.ts";
import { beginTurn } from "./steps.ts";

export function beginFirstTurn(state: GameState, cards: CardDatabase): Progress {
  const starting = state.pregame?.startingPlayer;
  if (starting === null || starting === undefined) throw new Error("No starting player");
  return beginTurn({ ...state, pregame: null }, starting, 1, cards);
}
