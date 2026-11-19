// Setting what the game waits for next (docs/architecture.md, "Actions and decisions").

import type { DecisionKind } from "../state/decisions.ts";
import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";
import { newDecisionId } from "./ids.ts";

/** Waits for `player` to make a decision of this kind. Each decision gets a new id, so stale answers are rejected. */
export function waitFor(state: GameState, player: PlayerId, kind: DecisionKind): GameState {
  // Only one decision can be pending; setting another would silently lose the first.
  if (state.pending !== null)
    throw new Error(`Already waiting for ${state.pending.kind}; can't also wait for ${kind.kind}`);
  const allocated = newDecisionId(state);
  return { ...allocated.state, pending: { id: allocated.id, player, ...kind } };
}
