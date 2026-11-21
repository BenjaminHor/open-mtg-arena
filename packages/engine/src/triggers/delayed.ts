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
import type { ObjectId } from "../state/ids.ts";
import type { DelayedTrigger, PendingTrigger } from "../state/triggers.ts";
import { matches } from "./match-event.ts";

/**
 * Makes a delayed triggered ability. Its source is the resolving spell's or ability's source, and its controller who
 * controlled that spell or ability as it resolved (CR 603.7d, 603.7e): `context.self` and `context.controller`. The
 * source's card is read from the resolving object itself, as the source may already be gone (CR 113.7a).
 */
export function createDelayedTrigger(
  state: GameState,
  ability: TriggeredAbilityDef,
  context: EffectContext,
  objects: readonly ObjectId[] = [],
): Progress {
  const resolving = state.resolution === null ? undefined : state.objects[state.resolution.object];
  if (resolving === undefined) throw new Error("a delayed trigger is made only as a spell or ability resolves");
  const sourceOracleId = resolving.kind === "card" ? resolving.oracleId : resolving.sourceOracleId;
  const delayed: DelayedTrigger = {
    source: context.self,
    sourceOracleId,
    controller: context.controller,
    ability,
    ...(objects.length > 0 && { objects: [...objects] }),
  };
  return { state: { ...state, delayedTriggers: [...state.delayedTriggers, delayed] }, events: [] };
}

/**
 * The delayed triggers these events trigger, each moved from `delayedTriggers` to `pendingTriggers` (CR 603.7b: once
 * only). Their conditions don't look their source up: it may be gone, and they still trigger (CR 603.7c leaves what
 * the effect then does to the effect).
 */
export function detectDelayed(state: GameState, events: readonly GameEvent[], cards: CardDatabase): GameState {
  if (state.delayedTriggers.length === 0) return state;
  const waiting: DelayedTrigger[] = [];
  const fired: PendingTrigger[] = [];
  for (const delayed of state.delayedTriggers) {
    // later: CR 603.7b, its controller chooses which of several simultaneous events triggered it; a step beginning
    // happens once.
    const event = events.flatMap((e) => matches(state, delayed.source, delayed.ability.when, e, cards))[0];
    if (event === undefined) waiting.push(delayed);
    else
      fired.push({
        source: delayed.source,
        sourceOracleId: delayed.sourceOracleId,
        ref: { kind: "delayed", ability: delayed.ability, ...(delayed.objects && { objects: delayed.objects }) },
        controller: delayed.controller,
        event,
      });
  }
  if (fired.length === 0) return state;
  return { ...state, delayedTriggers: waiting, pendingTriggers: [...state.pendingTriggers, ...fired] };
}
