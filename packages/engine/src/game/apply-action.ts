// applyAction: the engine's reducer (docs/architecture.md, "Engine API"). It checks the action answers the pending
// decision (except `CONCEDE`, which any player in the game may send at any time, CR 104.3a), applies it, and returns
// the new state and events. An illegal action changes nothing.

import type { CardDatabase } from "../cards/types.ts";
import { assignProblem, assignToNextBlocker, damageLeft } from "../combat/combat-damage.ts";
import { attackProblem, finishAttackers } from "../combat/declare-attackers.ts";
import { blockProblem, finishBlockers } from "../combat/declare-blockers.ts";
import { answerChooseCards, chooseCardsProblem } from "../effects/choose-cards.ts";
import { activateManaAbility, manaAbilityProblem, manaColorProblem } from "../mana/activate.ts";
import { findAbility, isManaAbility } from "../rules/abilities.ts";
import type { Action } from "../state/actions.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import type { AbilityRef } from "../state/objects.ts";
import type { EngineErrorCode, EngineResult } from "../state/result.ts";
import { zoneList } from "../zones/zone-list.ts";
import { activationProblem, startActivation } from "./activate-ability.ts";
import { advance } from "./advance.ts";
import { castProblem, startCast } from "./cast.ts";
import { activateWhilePaying, announceX, cancelCasting, nextCastingStep, payCost, xProblem } from "./casting-steps.ts";
import {
  chooseTarget,
  chooseTargetCount,
  divide,
  shareProblem,
  targetCountProblem,
  targetProblem,
} from "./choose-targets.ts";
import { playersLose } from "./game-end.ts";
import { passPriority } from "./pass-priority.ts";
import { playLand, playLandProblem } from "./play-land.ts";
import { canMulligan, declareMulligan, putOnBottom, setStartingPlayer } from "./pregame.ts";
import { chooseSacrifice, sacrificeProblem } from "./sacrifice-costs.ts";
import { queueWork } from "./work.ts";

export function applyAction(state: GameState, action: Action, cards: CardDatabase): EngineResult {
  const result = handleAction(state, action, cards);
  if (!result.ok) return result;
  // Every action is followed by running the queued work until the next decision (docs/architecture.md).
  return { ok: true, ...advance({ state: result.state, events: result.events }, cards) };
}

/**
 * Checks the action answers the pending decision (or is a concession), then applies it. The decision is cleared before
 * it's applied.
 */
function handleAction(state: GameState, action: Action, cards: CardDatabase): EngineResult {
  if (state.result !== null) return error("gameOver", "The game is over");
  // A player can concede at any time, whoever the game is waiting for (CR 104.3a).
  if (action.type === "CONCEDE") {
    if (!state.turnOrder.includes(action.player)) return error("illegalAction", `${action.player} isn't in the game`);
    return { ok: true, ...playersLose(state, [{ player: action.player, reason: "conceded" }]) };
  }
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
    // Other activated abilities use the stack and need priority (CR 602.2); mana abilities don't (CR 605.3a).
    if (pending.kind === "priority" && !isManaAbilityOf(answered, action.object, action.ability, cards)) {
      // Only "one mana of any color" takes a color (D-068); any other ability refuses one rather than dropping it.
      const problem =
        action.color !== undefined
          ? "only a mana ability of any color takes a color"
          : activationProblem(answered, pending.player, action.object, action.ability, cards);
      if (problem !== null) return error("illegalAction", problem);
      return { ok: true, ...startActivation(answered, pending.player, action.object, action.ability, cards) };
    }
    const problem =
      manaAbilityProblem(answered, pending.player, action.object, action.ability, cards) ??
      manaColorProblem(answered, action.object, action.ability, action.color, cards);
    if (problem !== null) return error("illegalAction", problem);
    // While paying a cost, a mana ability can be activated too (CR 605.3a); the payment is asked again after.
    if (pending.kind === "payMana")
      return { ok: true, ...activateWhilePaying(state, action.object, action.ability, cards, action.color) };
    return {
      ok: true,
      ...activateManaAbility(answered, pending.player, action.object, action.ability, cards, action.color),
    };
  }
  if (action.type === "PLAY_LAND") {
    if (pending.kind !== "priority")
      return error("illegalAction", `Playing a land doesn't answer a ${pending.kind} decision`);
    const problem = playLandProblem(answered, pending.player, action.object, cards);
    if (problem !== null) return error("illegalAction", problem);
    return { ok: true, ...playLand(answered, pending.player, action.object, cards) };
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
      return { ok: true, ...setStartingPlayer(answered, answer.player, pending.player, cards) };
    case "mulligan":
      if (answer.kind !== "mulligan") return mismatch;
      if (answer.choice === "mulligan" && !canMulligan(state, pending.player)) {
        return error("illegalAction", "No more mulligans: the hand would be zero cards (CR 103.5)");
      }
      return { ok: true, ...declareMulligan(answered, pending.player, answer.choice, cards) };
    case "mulliganBottom":
      if (answer.kind !== "mulliganBottom") return mismatch;
      if (!zoneList(state, { zone: "hand", player: pending.player }).includes(answer.object)) {
        return error("illegalAction", `${answer.object} isn't in ${pending.player}'s hand`);
      }
      return { ok: true, ...putOnBottom(answered, pending.player, answer.object, cards) };
    case "chooseCards": {
      const problem = chooseCardsProblem(pending, answer);
      if (problem !== null) return error("illegalAction", problem);
      return { ok: true, state: answerChooseCards(answered, pending, answer), events: [] };
    }
    case "chooseYesNo": {
      if (answer.kind !== "chooseYesNo") return mismatch;
      // Yes runs the effect, ahead of the rest of the resolution; no does nothing (CR 608.2d).
      if (!answer.yes) return { ok: true, state: answered, events: [] };
      return {
        ok: true,
        state: queueWork(answered, { kind: "runEffect", ...pending.resume, chosen: null }),
        events: [],
      };
    }
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
    case "announceX": {
      if (answer.kind === "cancelCast") return { ok: true, ...cancelCasting(answered) };
      if (answer.kind !== "announceX") return mismatch;
      const problem = xProblem(answer.value);
      if (problem !== null) return error("illegalAction", problem);
      return { ok: true, ...nextCastingStep(announceX(answered, answer.value), cards) };
    }
    case "chooseTargetCount": {
      if (answer.kind === "cancelCast") return { ok: true, ...cancelCasting(answered) };
      if (answer.kind !== "chooseTargetCount") return mismatch;
      const problem = targetCountProblem(pending, answer.count);
      if (problem !== null) return error("illegalAction", problem);
      return { ok: true, ...nextCastingStep(chooseTargetCount(answered, answer.count), cards) };
    }
    case "chooseTarget": {
      if (answer.kind === "cancelCast") return { ok: true, ...cancelCasting(answered) };
      if (answer.kind !== "chooseTarget") return mismatch;
      const problem = targetProblem(answered, answer.target, cards);
      if (problem !== null) return error("illegalAction", problem);
      return { ok: true, ...nextCastingStep(chooseTarget(answered, answer.target), cards) };
    }
    case "divide": {
      if (answer.kind === "cancelCast") return { ok: true, ...cancelCasting(answered) };
      if (answer.kind !== "divide") return mismatch;
      const problem = shareProblem(pending, answer.amount);
      if (problem !== null) return error("illegalAction", problem);
      // The next share is asked for here; once the last target gets the rest, casting goes on.
      const divided = divide(answered, pending, answer.amount);
      if (divided.pending !== null) return { ok: true, state: divided, events: [] };
      return { ok: true, ...nextCastingStep(divided, cards) };
    }
    case "chooseSacrifice": {
      if (answer.kind === "cancelCast") return { ok: true, ...cancelCasting(answered) };
      if (answer.kind !== "chooseSacrifice") return mismatch;
      const problem = sacrificeProblem(answered, answer.object, cards);
      if (problem !== null) return error("illegalAction", problem);
      return { ok: true, ...nextCastingStep(chooseSacrifice(answered, answer.object), cards) };
    }
    case "payMana": {
      if (answer.kind === "cancelCast") return { ok: true, ...cancelCasting(answered) };
      if (answer.kind !== "payMana") return mismatch;
      const paid = payCost(answered, pending.cost, answer.payment, cards);
      return typeof paid === "string" ? error("illegalAction", paid) : { ok: true, ...paid };
    }
    case "declareAttackers": {
      if (answer.kind === "finishDeclaring") return { ok: true, ...finishAttackers(answered, pending.chosen, cards) };
      if (answer.kind !== "declareAttacker") return mismatch;
      const problem = attackProblem(answered, pending.chosen, answer.attack, cards);
      if (problem !== null) return error("illegalAction", problem);
      const chosen = [...pending.chosen, answer.attack];
      return { ok: true, state: queueWork(answered, { kind: "declareAttackers", chosen }), events: [] };
    }
    case "declareBlockers": {
      if (answer.kind === "finishDeclaring") {
        return { ok: true, ...finishBlockers(answered, pending.player, pending.chosen) };
      }
      if (answer.kind !== "declareBlocker") return mismatch;
      const problem = blockProblem(answered, pending.chosen, answer.block, cards);
      if (problem !== null) return error("illegalAction", problem);
      const chosen = [...pending.chosen, answer.block];
      return { ok: true, state: queueWork(answered, { kind: "declareBlockers", chosen }), events: [] };
    }
    case "assignDamage": {
      if (answer.kind !== "assignDamage") return mismatch;
      const problem = assignProblem(damageLeft(pending.amount, pending.assigned), answer.amount);
      if (problem !== null) return error("illegalAction", problem);
      return { ok: true, state: assignToNextBlocker(answered, pending, answer.amount), events: [] };
    }
    case "priority":
      return mismatch;
  }
}

function error(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

/** Whether the object has this ability and it's a mana ability (CR 605.1a), which is activated without the stack. */
function isManaAbilityOf(state: GameState, object: ObjectId, ref: AbilityRef, cards: CardDatabase): boolean {
  const ability = findAbility(state, object, ref, cards);
  return ability !== null && isManaAbility(ability.def);
}
