// Delayed triggered abilities (CR 603.7): made by an effect as a spell or ability resolves ("sacrifice this creature at
// the beginning of the next end step"), they wait in `GameState.delayedTriggers` for their event, trigger once, the
// next time it happens, and are gone (CR 603.7b). Matched apart from the battlefield's abilities: no permanent has
// them, and the source may have left long ago.

import type { TriggeredAbilityDef } from "../cards/triggers.ts";
import type { CardDatabase } from "../cards/types.ts";
import type { Progress } from "../game/progress.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameEvent } from "../state/events.ts";
import type { GameState } from "../state/game-state.ts";
import type { PendingTrigger } from "../state/triggers.ts";
import { matches } from "./detect.ts";

/**
 * Makes a delayed triggered ability. Its source is the resolving spell's or ability's source, and its controller who
 * controlled that spell or ability as it resolved (CR 603.7d, 603.7e): `context.self` and `context.controller`.
 */
export function createDelayedTrigger(state: GameState, ability: TriggeredAbilityDef, context: EffectContext): Progress {
  const source = state.objects[context.self] ?? state.lastKnown[context.self];
  if (source === undefined) throw new Error(`no source ${context.self} for a delayed trigger`);
  const sourceOracleId = source.kind === "card" ? source.oracleId : source.sourceOracleId;
  const delayed = { source: context.self, sourceOracleId, controller: context.controller, ability };
  return { state: { ...state, delayedTriggers: [...state.delayedTriggers, delayed] }, events: [] };
}

/**
 * The delayed triggers these events trigger, each moved from `delayedTriggers` to `pendingTriggers` (CR 603.7b: once
 * only). Their conditions don't look their source up: it may be gone, and they still trigger (CR 603.7c leaves what
 * the effect then does to the effect).
 */
export function detectDelayed(state: GameState, events: readonly GameEvent[], cards: CardDatabase): GameState {
  if (state.delayedTriggers.length === 0) return state;
  const fired: PendingTrigger[] = [];
  const waiting = state.delayedTriggers.filter((d) => {
    const event = events.flatMap((e) => matches(state, d.source, d.ability.when, e, cards))[0];
    if (event === undefined) return true;
    fired.push({
      source: d.source,
      sourceOracleId: d.sourceOracleId,
      ref: { kind: "delayed", ability: d.ability },
      controller: d.controller,
      event,
    });
    return false;
  });
  if (fired.length === 0) return state;
  return { ...state, delayedTriggers: waiting, pendingTriggers: [...state.pendingTriggers, ...fired] };
}
