// "Create a 1/1 green Insect creature token" (CR 111.1): the `createTokens` op.

import { tokenData } from "../cards/token-data.ts";
import type { Amount, CardDatabase, TokenDef } from "../cards/types.ts";
import type { Progress } from "../game/progress.ts";
import { happen } from "../pipeline/happen.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import { amountNow } from "./subjects.ts";

/**
 * `amount` tokens, counted as the effect applies (CR 608.2h), created by "you", the controller (CR 109.5), who owns them
 * (CR 111.2). They're created together, as one event, so "whenever a creature enters" sees each (CR 603.6a, 603.2c).
 */
export function createTokens(
  state: GameState,
  token: TokenDef,
  amount: Amount,
  context: EffectContext,
  cards: CardDatabase,
): Progress {
  const count = amountNow(state, amount, context, cards);
  if (count <= 0) return { state, events: [] };
  // One data object for all of them: each token keeps it as its "printed" values (CR 111.3).
  const data = tokenData(token);
  const events = Array.from(
    { length: count },
    () => ({ kind: "createToken", player: context.controller, token: data }) as const,
  );
  return happen(state, { kind: "simultaneous", events }, cards);
}
