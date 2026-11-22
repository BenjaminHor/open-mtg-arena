// "If [condition], [effects]": the effects happen only if the condition holds, checked once as this effect is applied
// (CR 608.2c, 608.2h). Each condition reads something the resolution or the turn already recorded.

import type { Effect, EffectCondition } from "../cards/types.ts";
import { activationsThisTurn } from "../game/activation-count.ts";
import type { Progress } from "../game/progress.ts";
import { queueWork } from "../game/work.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";

/** Queues the effects, ahead of the rest of the resolution, if the condition holds now. */
export function ifCondition(
  state: GameState,
  condition: EffectCondition,
  effects: readonly Effect[],
  context: EffectContext,
): Progress {
  if (!holds(state, condition)) return { state, events: [] };
  const items = effects.map((effect) => ({ kind: "runEffect", effect, context, chosen: null }) as const);
  return { state: queueWork(state, ...items), events: [] };
}

function holds(state: GameState, condition: EffectCondition): boolean {
  switch (condition.kind) {
    case "nothingSacrificed":
      // "If you can't sacrifice [one]" (Xathrid Demon): `sacrificeEach` records what it started to sacrifice, not what
      // moved, so a replacement effect changing the move (CR 614.1a, Darksteel Colossus) doesn't change the answer
      // (CR 118.12: the sacrifice is a cost paid on resolution, and "can't" asks whether it was started).
      return (state.resolution?.sacrificed.length ?? 0) === 0;
    case "activatedThisTurn": {
      // "If this ability has been activated four or more times this turn" (Dragon Whelp): how many times this turn the
      // resolving activated ability has become activated, as of now, its own activation counted (D-078), so four
      // activations stacked before any resolves each see 4. Its source and index name the count (CR 113.7a: the
      // source may be gone, its count is kept by its old id).
      const resolving = state.resolution === null ? undefined : state.objects[state.resolution.object];
      if (resolving?.kind !== "ability" || resolving.ability.kind !== "printed")
        throw new Error("counting activations is only for an activated ability");
      return activationsThisTurn(state, resolving.source, resolving.ability.index) >= condition.atLeast;
    }
  }
}
