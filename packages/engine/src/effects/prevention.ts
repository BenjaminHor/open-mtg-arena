// "Prevent all [combat] damage that would be dealt [to you and creatures you control] this turn" (Fog, Safe Passage):
// a prevention effect kept in `GameState.replacements` until the cleanup step ends it (CR 615.1a, 514.2). Made outside
// the event pipeline, like a continuous effect; using it is the pipeline's (`pipeline/damage-replacements.ts`).

import type { Effect } from "../cards/types.ts";
import { newObjectId } from "../game/ids.ts";
import type { Progress } from "../game/progress.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import type { OracleId } from "../state/ids.ts";

export function preventAllDamage(
  state: GameState,
  effect: Extract<Effect, { op: "preventAllDamage" }>,
  context: EffectContext,
): Progress {
  // Its own id, so two of them are two effects even from one source (D-088).
  const made = newObjectId(state);
  const effectMade = {
    kind: "preventAllDamage",
    id: made.id,
    sourceOracleId: cardOf(made.state, context),
    controller: context.controller,
    combatOnly: effect.combatOnly,
    protects: effect.protects === "everyone" ? "everyone" : "controllerAndCreatures",
  } as const;
  return { state: { ...made.state, replacements: [...made.state.replacements, effectMade] }, events: [] };
}

/** The card whose spell or ability made the effect, which names it: the spell, or the ability's source as it last was. */
function cardOf(state: GameState, context: EffectContext): OracleId {
  const self = state.objects[context.self] ?? state.lastKnown[context.self];
  switch (self?.kind) {
    case "card":
      return self.oracleId;
    case "ability":
      return self.sourceOracleId;
    case undefined:
      throw new Error(`no card made the prevention effect from ${context.self}`);
  }
}
