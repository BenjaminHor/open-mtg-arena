import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { persistedGameStateView } from "../adapter/types";
import {
  loadActiveQuickDraft,
  type ActiveQuickDraftMeta,
} from "../services/quickDraftPersistence";
import {
  ACTIVE_GAME_CHANGED_EVENT,
  activeGamePointerToken,
  clearActiveGameIfUnchanged,
} from "../services/gamePersistence";
import {
  loadActiveGame,
  loadGame,
  useGameStore,
  type ActiveGameMeta,
} from "../stores/gameStore";

/** Live state of the saved local/AI match, read from its persisted GameState.
 *  Carries human-readable context for the resume hero, not raw board data. */
export interface MatchSummary {
  turn: number;
  /** True when the local human (seat 0) has the active turn. */
  isYourTurn: boolean;
  /** Life of the local human (seat 0); null when eliminated or absent. */
  yourLife: number | null;
  /** Non-eliminated opponents (every live seat except the human). */
  opponentCount: number;
}

export interface Resumables {
  /** The saved in-progress match, validated against its persisted session. */
  match: ActiveGameMeta | null;
  /** Turn/life snapshot of the saved match. */
  matchSummary: MatchSummary | null;
  quickDraft: ActiveQuickDraftMeta | null;
  /** Resume the saved match (mirrors the menu's resume routing). */
  resumeMatch: () => void;
}

/**
 * Single source of truth for "what can I resume?" — the saved AI/local match
 * (validated against its persisted state, clearing stale entries) plus any
 * in-progress quick draft.
 */
export function useResumables(): Resumables {
  const navigate = useNavigate();
  const [match, setMatch] = useState<ActiveGameMeta | null>(null);
  const [matchSummary, setMatchSummary] = useState<MatchSummary | null>(null);
  const [quickDraft, setQuickDraft] = useState<ActiveQuickDraftMeta | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Monotonic identity for one validation pass. A session/state lookup
    // belongs to the pass that started it; a storage notification supersedes
    // it, and a stale reply must neither write state nor clear the replacement
    // pointer the newer pass validated.
    let validation = 0;

    const validate = () => {
      const generation = ++validation;
      const isCurrent = () => !cancelled && generation === validation;

      setQuickDraft(loadActiveQuickDraft());

      const pointerToken = activeGamePointerToken();
      const saved = loadActiveGame();
      if (!saved) {
        setMatch(null);
        setMatchSummary(null);
        return;
      }

      // Validate the saved match against the state that actually backs it,
      // clearing the pointer when the backing data is gone so we never offer a
      // resume that would fail. The state lookup is async, so guard its
      // setState against a mid-flight unmount.
      loadGame(saved.id).then((state) => {
        if (!isCurrent()) return;
        if (state) {
          const publicState = persistedGameStateView(state);
          setMatch(saved);
          // CR 800.4: eliminated players are out — only live seats count as
          // opponents. Seat 0 is the local human.
          const you = publicState.players.find((p) => p.id === 0);
          const liveCount = publicState.players.filter((p) => !p.is_eliminated).length;
          setMatchSummary({
            turn: publicState.turn_number,
            isYourTurn: publicState.active_player === 0,
            yourLife: you && !you.is_eliminated ? you.life : null,
            opponentCount: Math.max(0, liveCount - 1),
          });
        } else {
          setMatch(null);
          setMatchSummary(null);
          clearActiveGameIfUnchanged(pointerToken);
        }
      });
    };

    validate();
    window.addEventListener("storage", validate);
    window.addEventListener(ACTIVE_GAME_CHANGED_EVENT, validate);

    return () => {
      cancelled = true;
      window.removeEventListener("storage", validate);
      window.removeEventListener(ACTIVE_GAME_CHANGED_EVENT, validate);
    };
  }, []);

  /** Route to a saved match's game page. */
  const openMatch = (meta: ActiveGameMeta) => {
    useGameStore.setState({ gameId: meta.id });
    // Multi-AI resume needs `players` so every AI seat respawns (one entry per
    // AI seat → +1 for the human). Older saves fall back to the 2-player default.
    const seatCount = meta.aiSeats?.length;
    const playersParam = seatCount && seatCount > 1 ? `&players=${seatCount + 1}` : "";
    navigate(`/game/${meta.id}?mode=${meta.mode}&difficulty=${meta.difficulty}${playersParam}`);
  };

  const resumeMatch = () => {
    if (!match) return;
    const current = loadActiveGame();
    if (!current || current.id !== match.id) {
      setMatch(null);
      setMatchSummary(null);
      return;
    }
    openMatch(match);
  };

  return {
    match,
    matchSummary,
    quickDraft,
    resumeMatch,
  };
}
