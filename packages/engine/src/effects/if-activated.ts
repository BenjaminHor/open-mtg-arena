// "If this ability has been activated four or more times this turn, [effects]" (Dragon Whelp): reads how many times
// this turn the resolving activated ability has become activated, as of now, its own activation counted (D-078). The
// count is read once, as the effect is applied (CR 608.2h), so four activations stacked before any resolves each see 4.

import type { Effect } from "../cards/types.ts";
import { activationsThisTurn } from "../game/activation-count.ts";
import type { Progress } from "../game/progress.ts";
import { queueWork } from "../game/work.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";

/** Queues the effects, ahead of the rest of the resolution, if the resolving ability's count is at least `atLeast`. */
export function ifActivatedThisTurn(
  state: GameState,
  atLeast: number,
  effects: readonly Effect[],
  context: EffectContext,
): Progress {
  // The resolving object is the activated ability; its source and index name the count (CR 113.7a: the source may be
  // gone, its count is kept by its old id).
  const resolving = state.resolution === null ? undefined : state.objects[state.resolution.object];
  if (resolving?.kind !== "ability" || resolving.ability.kind !== "printed")
    throw new Error("ifActivatedThisTurn is only for an activated ability");
  if (activationsThisTurn(state, resolving.source, resolving.ability.index) < atLeast) return { state, events: [] };
  const items = effects.map((effect) => ({ kind: "runEffect", effect, context, chosen: null }) as const);
  return { state: queueWork(state, ...items), events: [] };
}
