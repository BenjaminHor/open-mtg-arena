import type { PlayerId } from "../adapter/types.ts";
import { useGameStore } from "../stores/gameStore.ts";
import { waitingForReason, type WaitingReason } from "../game/waitingForRegistry.ts";
import { useCanActForWaitingState, usePlayerId, waitingPlayer } from "./usePlayerId.ts";

export interface TurnStatus {
  /** Whose turn it is (raw `active_player`), or null before the game starts. */
  activePlayerId: PlayerId | null;
  /** The seat that must act next (semantic actor), or null when nothing is pending. */
  waitingSeatId: PlayerId | null;
  /** True when it is the local player's turn (raw seat compare; NO perspective remap). */
  isMyTurn: boolean;
  /** True when the local player is the authorized actor for the pending decision. */
  canIActNow: boolean;
  /** True when a decision is pending and the local player is not the one to make it. */
  waitingOnOpponent: boolean;
  /** A localized reason descriptor for the pending decision, or null. */
  reason: WaitingReason | null;
}

/**
 * Single source of truth for "whose turn / who must act / why" presentation.
 *
 * Composes the existing authorities rather than re-deriving: `waitingPlayer()`
 * resolves the semantic actor (Vote delegation, Assist helper) and
 * `useCanActForWaitingState()` resolves "is it mine" (turn-control-aware). It deliberately does NOT read raw `priority_player`
 * (the engine re-derives that to the authorized submitter) and does NOT route
 * `isMyTurn` through `usePerspectivePlayerId()` — turn ownership is raw seat
 * identity, kept separate from decision authority so turn-control effects
 * (e.g. Mindslaver) never light two plates as active.
 */
export function useTurnStatus(): TurnStatus {
  const gameState = useGameStore((s) => s.gameState);
  const waitingFor = useGameStore((s) => s.waitingFor);
  const playerId = usePlayerId();
  const canIActNow = useCanActForWaitingState();

  const activePlayerId = gameState?.active_player ?? null;
  const waitingSeatId = waitingPlayer(waitingFor);
  const isMyTurn = activePlayerId != null && activePlayerId === playerId;
  const waitingOnOpponent = waitingSeatId != null && !canIActNow;
  const reason = waitingForReason(waitingFor, gameState ?? null);

  return { activePlayerId, waitingSeatId, isMyTurn, canIActNow, waitingOnOpponent, reason };
}
