// applyAction: the engine's reducer (docs/architecture.md, "Engine API"). It checks the action answers the pending
// decision, applies it, and returns the new state and events. An illegal action changes nothing.

import type { CardDatabase } from "../cards/types.ts";
import type { Action } from "../state/actions.ts";
import type { GameState } from "../state/game-state.ts";
import type { EngineErrorCode, EngineResult } from "../state/result.ts";
import { zoneList } from "../zones/zone-list.ts";
import { canMulligan, declareMulligan, putOnBottom, setStartingPlayer } from "./pregame.ts";

export function applyAction(state: GameState, action: Action, _cards: CardDatabase): EngineResult {
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
  if (action.type !== "ANSWER") return error("illegalAction", `${action.type} arrives with priority (M1-07)`);

  const answer = action.answer;
  const mismatch = error("illegalAction", `That doesn't answer a ${pending.kind} decision`);
  // Each case returns, so TypeScript reports a decision kind with no case here.
  switch (pending.kind) {
    case "chooseStartingPlayer":
      if (answer.kind !== "chooseStartingPlayer") return mismatch;
      if (!state.turnOrder.includes(answer.player)) return error("illegalAction", `${answer.player} isn't a player`);
      return { ok: true, ...setStartingPlayer(state, answer.player, pending.player) };
    case "mulligan":
      if (answer.kind !== "mulligan") return mismatch;
      if (answer.choice === "mulligan" && !canMulligan(state, pending.player)) {
        return error("illegalAction", "No more mulligans: the hand would be zero cards (CR 103.5)");
      }
      return { ok: true, ...declareMulligan(state, pending.player, answer.choice) };
    case "mulliganBottom":
      if (answer.kind !== "mulliganBottom") return mismatch;
      if (!zoneList(state, { zone: "hand", player: pending.player }).includes(answer.object)) {
        return error("illegalAction", `${answer.object} isn't in ${pending.player}'s hand`);
      }
      return { ok: true, ...putOnBottom(state, pending.player, answer.object) };
    case "priority":
      return mismatch;
  }
}

function error(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}
