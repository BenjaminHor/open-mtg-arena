import type { GameState, PlayerId, WaitingFor } from "../adapter/types";
import { PLAYER_ID } from "../constants/game";
import { useGameStore } from "../stores/gameStore";

/** React hook: the seat this client occupies. Every game is played from this
 *  client (against the AI, or hot-seat), and the local human sits in seat 0 by
 *  construction. */
export function usePlayerId(): PlayerId {
  return PLAYER_ID;
}

/** Non-React getter for use in plain functions (autoPass, gameLoopController). */
export function getPlayerId(): PlayerId {
  return PLAYER_ID;
}

/**
 * The seat that must act next for `waitingFor` — the *semantic* actor, which
 * differs from the engine's `priority_player` (the re-derived authorized
 * submitter). Resolves Vote delegation and Assist's chosen helper; otherwise
 * the variant's `player`. Exported so display surfaces (e.g. `useTurnStatus`)
 * read this single authority instead of cloning the logic.
 */
export function waitingPlayer(waitingFor: WaitingFor | null): PlayerId | null {
  if (!waitingFor || waitingFor.type === "GameOver") return null;
  // `VoteChoice.actor` names who submits the next `ChooseOption`. Classic
  // Council's-dilemma votes carry `{ type: "SubjectActs" }` so the current
  // subject (`player`) acts for themselves. Battlebond friend-or-foe (no
  // explicit CR section) carries `{ type: "Delegated", data: <controller> }`
  // so the spell controller is the authorized submitter while `player`
  // cycles through subjects. Resolving here makes
  // `useCanActForWaitingState` route the action to the correct seat.
  if (waitingFor.type === "VoteChoice") {
    const { actor, player } = waitingFor.data;
    return actor.type === "Delegated" ? actor.data : player;
  }
  // CR 702.132a: Assist payment — the CHOSEN helper acts on this step, not the
  // caster. The prompt carries `caster`/`chosen` (no `player` field), so route
  // authorization to `chosen` here. (`AssistChoosePlayer` carries `player` =
  // caster and falls through to the default below.)
  if (waitingFor.type === "AssistPayment") {
    return waitingFor.data.chosen;
  }
  // CR 732.2a: LoopShortcut routes authorization to the proposer, whose data
  // field is `proposer` (not `player`); mirror engine `acting_player()`
  // (game_state.rs). Without this the declare modal's actor gate returns false
  // and it never renders. `RespondToShortcut` carries `player` → default below.
  if (
    waitingFor.type === "LoopShortcut"
    || waitingFor.type === "PrecastCopyShortcutOffer"
  ) {
    return waitingFor.data.proposer;
  }
  return "player" in waitingFor.data ? waitingFor.data.player : null;
}

function canActForWaitingState(
  playerId: PlayerId,
  gameState: GameState | null,
  waitingFor: WaitingFor | null,
): boolean {
  const semanticPlayer = waitingPlayer(waitingFor);
  if (!gameState || semanticPlayer == null) return false;
  if (semanticPlayer === playerId) return true;
  return gameState.turn_decision_controller === playerId && semanticPlayer === gameState.active_player;
}

/** Synchronous authorization check for event handlers that must read the latest stores. */
export function getCanActForWaitingState(): boolean {
  const gameStore = useGameStore.getState();
  return canActForWaitingState(getPlayerId(), gameStore.gameState, gameStore.waitingFor);
}

export function usePerspectivePlayerId(): PlayerId {
  const playerId = usePlayerId();
  const gameState = useGameStore((s) => s.gameState);
  if (!gameState) return playerId;
  return gameState.turn_decision_controller === playerId ? gameState.active_player : playerId;
}

export function useCanActForWaitingState(): boolean {
  const playerId = usePlayerId();
  const gameState = useGameStore((s) => s.gameState);
  const waitingFor = useGameStore((s) => s.waitingFor);

  return canActForWaitingState(playerId, gameState, waitingFor);
}
