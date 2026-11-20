// Naming an effect a resolving spell or ability made, by its card, for when the spell is gone (CR 400.7).

import type { EffectContext } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import type { OracleId } from "../state/ids.ts";

/** The card whose spell or ability made the effect, which names it: the spell, or the ability's source as it last was. */
export function effectCardOf(state: GameState, context: EffectContext): OracleId {
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
