// applyAction: the engine's reducer (docs/architecture.md, "Engine API"). It checks the action answers the pending
// decision, applies it, and returns the new state and events. An illegal action changes nothing.

import type { CardDatabase } from "../cards/types.ts";
import { activateManaAbility, manaAbilityProblem } from "../mana/activate.ts";
import type { Action } from "../state/actions.ts";
import type { GameState } from "../state/game-state.ts";
import type { EngineErrorCode, EngineResult } from "../state/result.ts";
import { zoneList } from "../zones/zone-list.ts";
import { advance } from "./advance.ts";
import {
  activateWhilePaying,
  cancelCast,
  castProblem,
  chooseTarget,
  payForSpell,
  startCast,
  targetProblem,
} from "./cast.ts";
import { passPriority } from "./pass-priority.ts";
import { playLand, playLandProblem } from "./play-land.ts";
import { canMulligan, declareMulligan, putOnBottom, setStartingPlayer } from "./pregame.ts";
import { queueWork } from "./work.ts";

export function applyAction(state: GameState, action: Action, cards: CardDatabase): EngineResult {
  const result = handleAction(state, action, cards);
  if (!result.ok) return result;
  // Every action is followed by running the queued work until the next decision (docs/architecture.md).
  return { ok: true, ...advance({ state: result.state, events: result.events }, cards) };
}

/** Checks the action answers the pending decision, then applies it. The decision is cleared before it's applied. */
function handleAction(state: GameState, action: Action, cards: CardDatabase): EngineResult {
  if (state.result !== null) return error("gameOver", "The game is over");
  if (action.type === "CONCEDE") return error("illegalAction", "Conceding arrives in M1-15");
  const pending = state.pending;
  if (pending === null) return error("illegalAction", "The game isn't waiting for anything");
  if (action.decisionId !== pending.id) return error("staleDecision", `Expected an answer to ${pending.id}`);
  if (action.player !== pending.player) {
    return pending.kind === "priority"
      ? error("notYourPriority", `${pending.player} has priority`)
      : error("notYourDecision", `The decision is ${pending.player}'s`);
  }
  const answered: GameState = { ...state, pending: null };
  if (action.type === "PASS_PRIORITY") {
    if (pending.kind !== "priority") return error("illegalAction", `Passing doesn't answer a ${pending.kind} decision`);
    return { ok: true, ...passPriority(answered, pending.player) };
  }
  if (action.type === "ACTIVATE_ABILITY") {
    if (pending.kind !== "priority" && pending.kind !== "payMana") {
      return error("illegalAction", `Activating doesn't answer a ${pending.kind} decision`);
    }
    const problem = manaAbilityProblem(answered, pending.player, action.object, action.ability, cards);
    if (problem !== null) return error("illegalAction", problem);
    // While paying for a spell, a mana ability can be activated too (CR 605.3a); the payment is asked again after.
    if (pending.kind === "payMana")
      return { ok: true, ...activateWhilePaying(state, action.object, action.ability, cards) };
    return { ok: true, ...activateManaAbility(answered, pending.player, action.object, action.ability, cards) };
  }
  if (action.type === "PLAY_LAND") {
    if (pending.kind !== "priority")
      return error("illegalAction", `Playing a land doesn't answer a ${pending.kind} decision`);
    const problem = playLandProblem(answered, pending.player, action.object, cards);
    if (problem !== null) return error("illegalAction", problem);
    return { ok: true, ...playLand(answered, pending.player, action.object) };
  }
  if (action.type === "CAST_SPELL") {
    if (pending.kind !== "priority") return error("illegalAction", `Casting doesn't answer a ${pending.kind} decision`);
    const problem = castProblem(answered, pending.player, action.object, cards);
    if (problem !== null) return error("illegalAction", problem);
    return { ok: true, ...startCast(answered, pending.player, action.object, cards) };
  }

  const answer = action.answer;
  const mismatch = error("illegalAction", `That doesn't answer a ${pending.kind} decision`);
  // Each case returns, so TypeScript reports a decision kind with no case here.
  switch (pending.kind) {
    case "chooseStartingPlayer":
      if (answer.kind !== "chooseStartingPlayer") return mismatch;
      if (!state.turnOrder.includes(answer.player)) return error("illegalAction", `${answer.player} isn't a player`);
      return { ok: true, ...setStartingPlayer(answered, answer.player, pending.player) };
    case "mulligan":
      if (answer.kind !== "mulligan") return mismatch;
      if (answer.choice === "mulligan" && !canMulligan(state, pending.player)) {
        return error("illegalAction", "No more mulligans: the hand would be zero cards (CR 103.5)");
      }
      return { ok: true, ...declareMulligan(answered, pending.player, answer.choice) };
    case "mulliganBottom":
      if (answer.kind !== "mulliganBottom") return mismatch;
      if (!zoneList(state, { zone: "hand", player: pending.player }).includes(answer.object)) {
        return error("illegalAction", `${answer.object} isn't in ${pending.player}'s hand`);
      }
      return { ok: true, ...putOnBottom(answered, pending.player, answer.object) };
    case "discardToHandSize": {
      if (answer.kind !== "discardToHandSize") return mismatch;
      if (
        !zoneList(state, { zone: "hand", player: pending.player }).includes(answer.object) ||
        pending.chosen.includes(answer.object)
      ) {
        return error("illegalAction", `${answer.object} isn't a card in ${pending.player}'s hand not yet chosen`);
      }
      const chosen = [...pending.chosen, answer.object];
      return { ok: true, state: queueWork(answered, { kind: "finishCleanup", chosen }), events: [] };
    }
    case "chooseTarget": {
      if (answer.kind === "cancelCast") return { ok: true, ...cancelCast(answered) };
      if (answer.kind !== "chooseTarget") return mismatch;
      const problem = targetProblem(answered, pending.instance, answer.target, cards);
      if (problem !== null) return error("illegalAction", problem);
      return { ok: true, ...chooseTarget(answered, answer.target, cards) };
    }
    case "payMana": {
      if (answer.kind === "cancelCast") return { ok: true, ...cancelCast(answered) };
      if (answer.kind !== "payMana") return mismatch;
      const paid = payForSpell(answered, pending.cost, answer.payment);
      return typeof paid === "string" ? error("illegalAction", paid) : { ok: true, ...paid };
    }
    case "priority":
      return mismatch;
  }
}

function error(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}
