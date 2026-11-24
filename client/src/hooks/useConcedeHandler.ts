import { useCallback } from "react";
import { useNavigate } from "react-router";

import { clearPromptOverlayState } from "../game/sessionCleanup";
import { clearGame, useGameStore } from "../stores/gameStore";
import { useDraftStore } from "../stores/draftStore";
import { getPlayerId } from "./usePlayerId";

export interface ConcedeHandlerOptions {
  gameId: string;
  isDraft: boolean;
}

/**
 * Unified concede handler for the game menu's "Concede" action.
 *
 * CR 104.3a: A player can concede the game at any time. A player who concedes
 *   leaves the game. That player loses the game.
 * CR 800.4a: When a player leaves a multiplayer game, all permanents/spells/
 *   abilities owned by that player leave the game, and SBAs (CR 704) then
 *   resolve the resulting game state.
 *
 * An earlier implementation cleared local game persistence and navigated home
 * without ever dispatching `GameAction::Concede` to the engine. Because
 * `WasmAdapter` is a module-level singleton kept alive across sessions for V8
 * TurboFan re-warm (see adapter/wasm-adapter.ts), the conceded `GameState`
 * survived in the worker's `RefCell<Option<GameState>>` and remained fully
 * playable on navigation back. This hook fixes that by awaiting a real
 * `Concede` dispatch before clearing local state.
 *
 * Branches (priority order):
 *  1. `isDraft` — quick-draft single-match concede.
 *  2. Default — AI / local: dispatch `Concede` to the engine, then clear local
 *     state and navigate home.
 */
export function useConcedeHandler({ gameId, isDraft }: ConcedeHandlerOptions): () => void {
  const navigate = useNavigate();

  return useCallback(() => {
    if (isDraft) {
      void useDraftStore
        .getState()
        .recordMatchResult(gameId, "loss")
        .then(() => {
          clearGame(gameId);
          navigate("/draft/quick?resume=1");
        });
      return;
    }

    // Awaiting the dispatch BEFORE clearGame + navigate is the bug fix —
    // it forces the engine to process Concede and run SBAs (CR 704 / 704.5a)
    // before the local persistence layer drops the game ID. Without the
    // await, the WasmAdapter singleton retains the conceded game and the
    // user can resume it by navigating back.
    void useGameStore
      .getState()
      .dispatch({ type: "Concede", data: { player_id: getPlayerId() } })
      .then(async () => {
        clearPromptOverlayState();
        await clearGame(gameId);
        navigate("/");
      })
      .catch(async (err) => {
        console.error("[useConcedeHandler] concede dispatch failed:", err);
        // Still clear + navigate on failure — the user has decided to leave.
        clearPromptOverlayState();
        await clearGame(gameId);
        navigate("/");
      });
  }, [gameId, isDraft, navigate]);
}
