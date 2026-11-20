// Putting triggered abilities on the stack (CR 603.3), each time a player would receive priority, after state-based
// actions (CR 117.5). The waiting triggers are taken as one batch: the active player's go on the stack first, then each
// other player's in turn order (APNAP, CR 603.3b, 101.4), each player ordering their own. Then state-based actions are
// checked again, and triggers that came up meanwhile go on as a new batch, until none are left and the player who
// would have received priority does (CR 603.3b).

import type { CardDatabase } from "../cards/types.ts";
import { nextCastingStep } from "../game/casting-steps.ts";
import { waitFor } from "../game/decide.ts";
import type { Progress } from "../game/progress.ts";
import { apnapOrder } from "../game/turn-order.ts";
import { queueWork } from "../game/work.ts";
import { triggeredAbilityDef } from "../rules/abilities.ts";
import { targetsProblem } from "../rules/targets.ts";
import type { Casting } from "../state/casting.ts";
import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";
import type { PendingTrigger } from "../state/triggers.ts";
import { putAbilityOnStack } from "../zones/stack-abilities.ts";

/**
 * Takes the waiting triggers as one batch, so a trigger that comes up while they're put on the stack waits for the next
 * batch (CR 603.3b). `player` is who receives priority once they're all on.
 */
export function startPuttingTriggers(state: GameState, player: PlayerId): GameState {
  const batch = state.pendingTriggers;
  return queueWork({ ...state, pendingTriggers: [] }, { kind: "putTriggers", batch, player });
}

/**
 * Puts the next trigger of the batch on the stack: the next player in APNAP order with any chooses which of theirs goes
 * next, if they have several (CR 603.3b). With the batch done, priority is given again, which checks state-based
 * actions and new triggers first (CR 117.5).
 */
export function putTriggers(
  state: GameState,
  batch: readonly PendingTrigger[],
  player: PlayerId,
  cards: CardDatabase,
): Progress {
  if (batch.length === 0) return { state: queueWork(state, { kind: "givePriority", player }), events: [] };
  const next = apnapOrder(state).find((p) => batch.some((t) => t.controller === p));
  if (next === undefined) throw new Error("a pending trigger's controller isn't in the game");
  const theirs = batch.filter((t) => t.controller === next);
  if (theirs.length > 1) {
    return {
      state: waitFor(state, next, { kind: "orderTriggers", batch: [...batch], priorityTo: player }),
      events: [],
    };
  }
  return putOne(state, batch, batch.indexOf(theirs[0] as PendingTrigger), player, cards);
}

/**
 * Puts this trigger of the batch on the stack, then goes on with the rest. Its controller chooses its targets as it goes
 * on, like casting a spell but with nothing to pay and no cancel (CR 603.3d); one with too few legal targets is removed
 * from the stack instead, doing nothing (CR 603.3d).
 */
export function putOne(
  state: GameState,
  batch: readonly PendingTrigger[],
  index: number,
  player: PlayerId,
  cards: CardDatabase,
): Progress {
  const trigger = batch[index];
  if (trigger === undefined) throw new Error(`no trigger ${index} in the batch`);
  const rest = batch.filter((_, i) => i !== index);
  const goOn = (s: GameState) => queueWork(s, { kind: "putTriggers", batch: rest, player });
  const def = triggeredAbilityDef(trigger.sourceOracleId, trigger.index, cards);
  const ref = { kind: "triggered", index: trigger.index } as const;
  const put = putAbilityOnStack(state, trigger.source, trigger.sourceOracleId, ref, trigger.controller, trigger.event);
  // Checked for the ability itself, the object that targets (CR 115.5); too few legal targets, and it's removed.
  const by = { object: put.id, controller: trigger.controller };
  if (targetsProblem(put.state, def.targets, by, cards) !== null) return { state: goOn(state), events: [] };
  const events = [
    { type: "ABILITY_TRIGGERED", object: put.id, source: trigger.source, controller: trigger.controller } as const,
  ];
  if (def.targets.length === 0) return { state: goOn(put.state), events };
  const ps = put.state.players[trigger.controller];
  if (ps === undefined) throw new Error(`no player ${trigger.controller}`);
  const casting: Casting = {
    player: trigger.controller,
    object: put.id,
    origin: { kind: "trigger", batch: rest, priorityTo: player },
    poolBefore: ps.manaPool,
    tappedForMana: [],
    targetCounts: [],
    sacrifices: [],
  };
  const targeting = nextCastingStep({ ...put.state, casting }, cards);
  return { state: targeting.state, events: [...events, ...targeting.events] };
}

/** Why this answer can't choose this trigger to go on the stack next, or null. */
export function orderTriggersProblem(batch: readonly PendingTrigger[], player: PlayerId, index: number): string | null {
  return batch[index]?.controller === player ? null : `choose one of your own triggered abilities (CR 603.3b)`;
}
