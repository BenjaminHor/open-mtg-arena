import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type {
  AbilityBlockEntry,
  EngineAdapter,
  EngineSnapshot,
  FormatConfig,
  GameAction,
  GameEvent,
  GameLogEntry,
  GameState,
  LegalActionsResult,
  ManaCost,
  MatchConfig,
  ObjectAction,
  ObjectId,
  PlayerId,
  PersistedGameState,
  RewindOption,
  RestoredStackAutomationPresentation,
  StuckDecisionDiagnostic,
  WaitingFor,
} from "../adapter/types";
import type { ViewerInteraction } from "../adapter/generated/interaction";
import { MAX_UNDO_HISTORY, UNDOABLE_ACTIONS } from "../constants/game";
import { applySpellPaymentPreference } from "../game/castPaymentMode";
import { reportStructuredActionRejection } from "../game/actionRejectionReporter";
import { getPlayerId } from "../hooks/usePlayerId";
import { captureTrustedCheckpoint, loadCheckpoints, saveAuthoritativeGame, saveAuthoritativeGameStrict } from "../services/gamePersistence";
import { resetStackThroughput } from "../utils/stackThroughput";

/** Map a LegalActionsResult to the store fields it owns — single source of truth. */
export function legalResultState(result: LegalActionsResult): Pick<GameStoreState, "legalActions" | "autoPassRecommended" | "endContinuousEffectOffers" | "manaPaymentShortcutActions" | "spellCosts" | "legalActionsByObject" | "activationBlockReasons" | "stuckDiagnostic" | "viewerInteraction"> {
  return {
    legalActions: result.actions,
    autoPassRecommended: result.autoPassRecommended,
    endContinuousEffectOffers: result.endContinuousEffectOffers ?? [],
    manaPaymentShortcutActions: result.manaPaymentShortcutActions ?? [],
    spellCosts: result.spellCosts ?? {},
    legalActionsByObject: result.legalActionsByObject ?? {},
    activationBlockReasons: result.activationBlockReasons ?? {},
    stuckDiagnostic: result.stuckDiagnostic ?? null,
    viewerInteraction: result.viewerInteraction ?? null,
  };
}

// Re-export persistence API so existing imports keep working
export type { ActiveGameMeta } from "../services/gamePersistence";
export {
  saveGame,
  saveAuthoritativeGame,
  captureTrustedCheckpoint,
  loadGame,
  clearGame,
  saveCheckpoints,
  loadCheckpoints,
  saveActiveGame,
  loadActiveGame,
  clearActiveGame,
} from "../services/gamePersistence";

/** How the current game is played: against the AI, or hot-seat (`local`, two
 *  humans at one screen). Either way this client owns the engine state and the
 *  local human sits in seat 0. */
export type GameMode = "ai" | "local";

/**
 * One step of the undo ring: a trusted pre-action checkpoint, and where the game
 * log stood when the action it precedes was committed.
 *
 * The log lives in this store, not in the engine state a restore puts back, so
 * undo rewinds it itself. Without the position, the log would keep the plays an
 * undo took back, and so would the history an LLM seat's prompt is built from.
 */
export interface UndoCheckpoint {
  /** The engine-authored trusted envelope `undoLastAction` restores. */
  state: PersistedGameState;
  /**
   * The `seq` the action it precedes gave its first log entry when it was
   * committed (the next seq, if it logged none). Undo keeps only the entries
   * below it.
   */
  logSeq: number;
}

interface GameStoreState {
  gameId: string | null;
  gameMode: GameMode | null;
  gameState: GameState | null;
  events: GameEvent[];
  eventHistory: GameEvent[];
  logHistory: GameLogEntry[];
  nextLogSeq: number;
  adapter: EngineAdapter | null;
  /** Monotonically unique local game lifecycle identity. Unlike gameId, it
   * changes for a fresh init/resume/reset even when the adapter and id are
   * reused. Transient: never persisted or restored from engine snapshots. */
  gameSessionGeneration: number;
  waitingFor: WaitingFor | null;
  legalActions: GameAction[];
  autoPassRecommended: boolean;
  /** Ordered engine-authored CR 116.2c offers, rendered unchanged. */
  endContinuousEffectOffers: NonNullable<LegalActionsResult["endContinuousEffectOffers"]>;
  /** Exact engine-authored actions dispatched by the tap-all-mana shortcut. */
  manaPaymentShortcutActions: GameAction[];
  /** Effective mana costs for castable spells, keyed by object_id string. */
  spellCosts: Record<string, ManaCost>;
  /**
   * Engine-grouped per-object actions keyed by source object id.
   * May include mana actions that are intentionally absent from flat
   * `legalActions`; frontend "what can I do with this card?" lookups go
   * through this map instead of inferring action availability from objects.
   */
  legalActionsByObject: Record<string, ObjectAction[]>;
  /**
   * CR 118.3: acting-player-scoped read-out of activated abilities withheld
   * solely because their cost is unpayable right now, keyed by object_id
   * string. Display only — never dispatchable. Default `{}`, matching
   * `legalActionsByObject`.
   */
  activationBlockReasons: Record<string, AbilityBlockEntry[]>;
  /**
   * Engine-owned non-fatal progress-wedge diagnostic (an engine anomaly, not a
   * rules outcome) — present only when the current decision is wedged (no legal
   * action for any authorized submitter). `null` in normal play. Display-only
   * (drives `StuckDecisionToast`).
   */
  stuckDiagnostic: StuckDecisionDiagnostic | null;
  /** Viewer-scoped interaction projection from the same engine snapshot. */
  viewerInteraction: ViewerInteraction | null;
  /** Undo ring: engine-authored trusted checkpoints, never screen projections. */
  stateHistory: UndoCheckpoint[];
  /**
   * The undo in flight, from the moment `undoLastAction` begins it, before its
   * first await, until its board is committed or its failure handled; `null`
   * otherwise. Meanwhile the store still shows the state being undone while
   * the engine may already hold the restored one, so no choice made on that
   * board reaches the engine (standing preferences still go through), and
   * the AI controller drops the decision under way and starts none.
   * Transient: `reset` clears it.
   */
  pendingUndoId: number | null;
  /** Debug rewind targets: trusted envelopes for the same reason. */
  turnCheckpoints: PersistedGameState[];
  /**
   * Server-published turn boundaries offered as rollback targets. Mirrors the
   * server exactly — never appended to client-side, never derived. Empty on
   * every transport that does not publish them (which is all of them except a
   * `SingleUser` phase-server sidecar).
   */
  rewindTargets: RewindOption[];
  /** One-shot engine-authored summary of automation completed during a restore. */
  restoredStackAutomation: RestoredStackAutomationPresentation | null;
  /**
   * Pure-data carrier for the starting-player d20 contest (CR 103.1): the
   * game-start batch carrying the `StartingPlayerContest` event, whose
   * `winner` the overlay reports. Set once by `initGame` (null when the starter
   * was chosen explicitly). A GamePage effect consumes it to drive the dice overlay and
   * clears it via `clearStartingContest`. The store holds only data — it never
   * calls the UI store, keeping the layer boundary clean.
   */
  startingContest: { events: GameEvent[] } | null;
  /**
   * PlayerIds bound to AI controllers this game. Client-owned lobby/session
   * config (NOT game-state derivation): set at game init from the resolved AI
   * seat bindings and cleared on `reset`. Empty for hot-seat games.
   */
  aiSeatIds: PlayerId[];
  /**
   * `EngineSnapshot.seq` of the most recently committed engine pair — the gate
   * `commitEngineSnapshot` uses to drop commits derived from an older engine
   * version than one already applied. Transient (never persisted); returns to 0
   * with the rest of `initialState` on `reset`.
   */
  lastCommittedSeq: number;
  /**
   * Monotonic local commit counter. Unlike `lastCommittedSeq`, this advances
   * for an accepted equal-sequence snapshot too, so asynchronous display
   * previews can prove they still describe the current engine snapshot.
   */
  engineCommitEpoch: number;
  /**
   * Engine-returned mana sources for the spell currently being dragged. This
   * display state is cleared with every accepted engine snapshot.
   */
  manaPaymentPreviewSourceIds: ObjectId[];
}

/**
 * Fields written exclusively by `commitEngineSnapshot` from the snapshot's own
 * contents. `extraState` structurally EXCLUDES them: were they writable there,
 * a caller could smuggle an ungated pair field past the revision gate and
 * reintroduce exactly the mixed-epoch commit this authority exists to prevent.
 * `lastCommittedSeq` (the gate counter itself) is excluded for the same reason.
 */
type CommitExtraState = Partial<Omit<GameStoreState,
  | "gameState"
  | "waitingFor"
  | "legalActions"
  | "autoPassRecommended"
  | "endContinuousEffectOffers"
  | "manaPaymentShortcutActions"
  | "spellCosts"
  | "legalActionsByObject"
  | "activationBlockReasons"
  | "stuckDiagnostic"
  | "lastCommittedSeq"
  | "engineCommitEpoch"
  | "manaPaymentPreviewSourceIds">>;

interface GameStoreActions {
  initGame: (
    gameId: string,
    adapter: EngineAdapter,
    deckData?: unknown,
    formatConfig?: FormatConfig,
    playerCount?: number,
    matchConfig?: MatchConfig,
    firstPlayer?: number,
    initialSave?: "best-effort" | "strict",
  ) => Promise<void>;
  resumeGame: (gameId: string, adapter: EngineAdapter, savedState: PersistedGameState) => Promise<void>;
  dispatch: (action: GameAction) => Promise<GameEvent[]>;
  /**
   * Replace the server-published rollback targets. Only `dispatch.ts` calls
   * this, and only from inside its generation gate — a superseded remote update
   * must not clobber the list with a stale one.
   */
  setRewindTargets: (targets: RewindOption[]) => void;
  reset: () => void;
  setAdapter: (adapter: EngineAdapter) => void;
  /**
   * THE single writer of the live-game engine pair (`gameState`, `waitingFor`,
   * and every `legalResultState(...)` field). Every live-game commit — local
   * dispatch, remote update, batch resolve, init, resume, undo, restore —
   * routes through here.
   *
   * Revision gate: the pair is applied iff `snapshot.seq >= lastCommittedSeq`,
   * so a commit derived from an OLDER engine version can never clobber a newer
   * one already applied. (Equal seq arises only from two reads of the same
   * cached wire snapshot, whose pairs are byte-identical, so `>=` is idempotent
   * and lets a remote update and a local read of that snapshot coexist.)
   * Returns false when the pair was dropped as stale.
   *
   * Events, log entries, and undo checkpoints are applied ALWAYS, even for a
   * dropped pair: history is ordered by arrival, not by engine epoch, and a
   * checkpoint is a pre-action state that stays valid whichever pair wins.
   *
   * Known residue (documented, not fixed here): because history applies
   * unconditionally, a leftover cross-match commit can append game-1 entries
   * into game-2's histories after its pair is correctly dropped. Strictly less
   * wrong than the pre-fix behavior, where the whole stale pair clobbered.
   *
   * Documented exemptions from this authority (all write outside a live game,
   * or are immediately superseded by a newest-by-construction commit):
   * `replayStore` timeline scrubbing, the GameOver-only `waitingFor` writes in
   * `GamePage`, `sessionCleanup`'s session-boundary prompt clear, and the
   * teardown clears in `GameProvider`/`disposeMatchAdapter`.
   */
  commitEngineSnapshot: (
    snapshot: EngineSnapshot,
    opts?: {
      /** Replaces `events`; appended to `eventHistory`. Applied even when the pair is dropped. */
      events?: GameEvent[];
      /** Seq-stamped and appended to `logHistory`. Applied even when the pair is dropped. */
      logEntries?: GameLogEntry[];
      /**
       * The trusted pre-action checkpoint this commit's action can be undone
       * to. Pushed onto the undo ring (capped at `MAX_UNDO_HISTORY`) with the
       * log position this commit's own entries start at. Applied even when the
       * pair is dropped.
       */
      undoCheckpoint?: PersistedGameState;
      /**
       * Site-specific fields applied in the SAME `set()` — but only when the
       * pair commit is accepted, and after the base commit + history handling,
       * so init/resume/restore sites can atomically reset or seed history
       * fields alongside their pair.
       */
      extraState?: CommitExtraState;
    },
  ) => boolean;
  setGameMode: (mode: GameMode) => void;
  dismissRestoredStackAutomation: () => void;
  setManaPaymentPreviewSourceIds: (sourceIds: ObjectId[]) => void;
  clearManaPaymentPreview: () => void;
  /** Clear the starting-player contest after the overlay has consumed it. */
  clearStartingContest: () => void;
}

let latestGameSessionGeneration = 0;

export function nextGameSessionGeneration(): number {
  latestGameSessionGeneration += 1;
  return latestGameSessionGeneration;
}

export type GameStore = GameStoreState & GameStoreActions;

/**
 * Whether an undo would take an action back now: this client owns the engine
 * state, the ring holds a checkpoint to restore, and no undo is running yet.
 * `undoLastAction` asks before it abandons the work in flight, so a press with
 * nothing to undo leaves that work alone.
 */
export function canUndo(store: GameStore): store is GameStore & { adapter: EngineAdapter } {
  return (
    store.adapter !== null
    && store.pendingUndoId === null
    && store.stateHistory.length > 0
  );
}

const initialState: GameStoreState = {
  gameId: null,
  gameMode: null,
  gameState: null,
  events: [],
  eventHistory: [],
  logHistory: [],
  nextLogSeq: 0,
  adapter: null,
  gameSessionGeneration: nextGameSessionGeneration(),
  waitingFor: null,
  legalActions: [],
  autoPassRecommended: false,
  endContinuousEffectOffers: [],
  manaPaymentShortcutActions: [],
  spellCosts: {},
  legalActionsByObject: {},
  activationBlockReasons: {},
  stuckDiagnostic: null,
  viewerInteraction: null,
  stateHistory: [],
  pendingUndoId: null,
  turnCheckpoints: [],
  rewindTargets: [],
  restoredStackAutomation: null,
  startingContest: null,
  aiSeatIds: [],
  lastCommittedSeq: 0,
  engineCommitEpoch: 0,
  manaPaymentPreviewSourceIds: [],
};

export const useGameStore = create<GameStore>()(
  subscribeWithSelector((set, get) => ({
    ...initialState,

    commitEngineSnapshot: (snapshot, opts) => {
      // Decide the gate BEFORE `set`, so the updater stays a pure reducer.
      // Safe: `get()` → `set()` runs synchronously with no `await` between, so
      // no other commit can land in the window.
      const accepted = snapshot.seq >= get().lastCommittedSeq;

      set((prev) => {
        // Seq-stamp incoming log entries against the CURRENT counter.
        let nextLogSeq = prev.nextLogSeq;
        const stampedLogEntries = (opts?.logEntries ?? []).map((entry) => ({
          ...entry,
          seq: nextLogSeq++,
        }));

        return {
          // 1. The engine pair — gated.
          ...(accepted
            ? {
                gameState: snapshot.state,
                waitingFor: snapshot.state.waiting_for,
                ...legalResultState(snapshot.legalResult),
                lastCommittedSeq: snapshot.seq,
                engineCommitEpoch: prev.engineCommitEpoch + 1,
                manaPaymentPreviewSourceIds: [],
              }
            : {}),
          // 2. History — ordered by arrival, so applied unconditionally.
          ...(opts?.events
            ? {
                events: opts.events,
                eventHistory: [...prev.eventHistory, ...opts.events].slice(-1000),
              }
            : {}),
          ...(opts?.logEntries
            ? {
                logHistory: [...prev.logHistory, ...stampedLogEntries].slice(-2000),
                nextLogSeq,
              }
            : {}),
          ...(opts?.undoCheckpoint
            ? {
                // The position is read in the same update that stamps this
                // commit's entries, so it is exactly where they begin: undoing
                // the action takes back its own lines and every later one.
                stateHistory: [
                  ...prev.stateHistory,
                  { state: opts.undoCheckpoint, logSeq: prev.nextLogSeq },
                ].slice(-MAX_UNDO_HISTORY),
              }
            : {}),
          // 3. Site-specific fields last, so an init/resume/restore reset wins
          //    over the history append above.
          ...(accepted ? opts?.extraState : undefined),
        };
      });
      return accepted;
    },

    initGame: async (gameId, adapter, deckData, formatConfig, playerCount, matchConfig, firstPlayer, initialSave = "best-effort") => {
      // Clear the display-only stack-pacing tracker so a fast-churning end to a
      // prior game can't bleed stale resolution rate into this game's opening
      // pacing (rematch started within the throughput window).
      resetStackThroughput();
      await adapter.initialize();
      // Network-backed adapters can publish the initial authoritative snapshot
      // from inside `initializeGame`. Bind the transport before that happens so
      // the shared remote-update path never commits a visible game state whose
      // action dispatcher has no adapter yet.
      set({ adapter });
      let initResult;
      try {
        initResult = await adapter.initializeGame(
          deckData,
          formatConfig,
          playerCount,
          matchConfig,
          firstPlayer,
        );
      } catch (error) {
        // A failed initialization must not leave a transport that never
        // produced a playable game attached to the store.
        if (get().adapter === adapter) set({ adapter: null });
        throw error;
      }
      // Fetched AFTER the engine is initialized, so this snapshot is
      // newest-by-construction under the global counter — it always passes the
      // gate, and it drops any leftover in-flight commit from a prior match.
      const snapshot = await adapter.getSnapshot();
      const state = snapshot.state;
      if (initialSave === "strict") {
        try {
          await saveAuthoritativeGameStrict(gameId, adapter, state);
        } catch (error) {
          if (get().adapter === adapter) set({ adapter: null });
          throw error;
        }
      }
      const initLogEntries = (initResult.log_entries ?? []).map((entry, i) => ({
        ...entry,
        seq: i,
      }));
      // CR 103.1: capture the starting-player d20 contest as pure data so the
      // dice overlay can animate the engine's authoritative result. Present only
      // when the engine rolled; absent for an explicit play/draw choice. The
      // overlay reads the roll winner from the event itself — never recomputed from
      // the rolls, and never taken from `current_starting_player`.
      const initEvents = initResult.events ?? [];
      // The engine emits a single StartingPlayerContest event (round structure +
      // winner) at the head of the game-start batch when it ran a roll-off
      // (random starter); absent for an explicit play/draw choice.
      const rolledStart = initEvents[0]?.type === "StartingPlayerContest";
      const startingContest = rolledStart ? { events: initEvents } : null;
      get().commitEngineSnapshot(snapshot, {
        extraState: {
          gameId,
          adapter,
          gameSessionGeneration: nextGameSessionGeneration(),
          events: [],
          eventHistory: [],
          logHistory: initLogEntries,
          nextLogSeq: initLogEntries.length,
          stateHistory: [],
          turnCheckpoints: [],
          rewindTargets: [],
          startingContest,
          restoredStackAutomation: null,
        },
      });
      if (initialSave === "best-effort") void saveAuthoritativeGame(gameId, adapter, state);
    },

    resumeGame: async (gameId, adapter, savedState) => {
      // Reset stack-pacing throughput — resuming may load a different game than
      // the one just played; stale churn must not carry across.
      resetStackThroughput();
      await adapter.initialize();
      await adapter.restoreState(savedState);
      // Saved-game loading is the sole client restore boundary that resumes an
      // engine-owned stack session. Undo and developer restores stay pure.
      const resumed = await adapter.resumeRestoredGameState?.() ?? null;
      const snapshot = resumed?.snapshot ?? await adapter.getSnapshot();
      const savedCheckpoints = await loadCheckpoints(gameId);
      get().commitEngineSnapshot(snapshot, {
        extraState: {
          gameId,
          adapter,
          gameSessionGeneration: nextGameSessionGeneration(),
          events: [],
          eventHistory: [],
          logHistory: [],
          nextLogSeq: 0,
          stateHistory: [],
          turnCheckpoints: savedCheckpoints,
          rewindTargets: [],
          restoredStackAutomation: resumed?.presentation ?? null,
        },
      });
      await saveAuthoritativeGame(gameId, adapter, snapshot.state);
    },

    dispatch: async (action) => {
      const submittedAction = applySpellPaymentPreference(action);
      const { adapter, gameState, gameId, gameMode, gameSessionGeneration, pendingUndoId } = get();
      if (!adapter || !gameState) {
        throw new Error("Game not initialized");
      }
      // An action chosen on the board an undo is taking back must not reach
      // the engine, which may already hold the restored game (see
      // `undoLastAction` in `dispatch.ts`).
      if (pendingUndoId !== null) {
        console.info(`[undo] dispatch refused during an undo: ${submittedAction.type}`);
        return [];
      }

      // Save current state for undo. Two conditions must hold:
      // 1. Action type is in UNDOABLE_ACTIONS (no hidden-info leaks).
      // 2. Stack is empty. Checkpoints exist only at stack-empty boundaries
      //    so undo always lands the player before the most recent
      //    activation/trigger sequence, never mid-resolution.
      const shouldSaveHistory =
        UNDOABLE_ACTIONS.has(submittedAction.type) &&
        gameState.stack.length === 0;

      // Fire the trusted-envelope capture WITHOUT awaiting it: both engine
      // transports execute requests strictly in call order (worker message
      // FIFO; fallback promise chain), so an export issued here runs before
      // the submit below and observes the pre-action state — while the action
      // itself pays no added latency. Awaited at commit time. A failed capture
      // degrades to no checkpoint for this action rather than failing it.
      const checkpointPromise = shouldSaveHistory
        ? captureTrustedCheckpoint(adapter).catch(() => null)
        : null;

      // `getPlayerId()` returns the local human's authenticated seat ID.
      // The engine rejects the action if this doesn't match the authorized
      // submitter — never trust the UI to route actions to the right seat.
      let result: Awaited<ReturnType<EngineAdapter["submitAction"]>>;
      try {
        result = await adapter.submitAction(submittedAction, getPlayerId());
      } catch (err) {
        if (reportStructuredActionRejection(err) === "stale") {
          const snapshot = await adapter.getSnapshot();
          get().commitEngineSnapshot(snapshot, { events: [], logEntries: [] });
          if (gameId) void saveAuthoritativeGame(gameId, adapter, snapshot.state);
          return [];
        }
        throw err;
      }
      // ONE atomic pair — a separate getState()/getLegalActions() pair could
      // straddle an engine advance and commit a mismatched state/actions pair.
      const snapshot = await adapter.getSnapshot();

      // Read-then-commit with no `await` between, so no other commit interleaves.
      const checkpoint = checkpointPromise ? await checkpointPromise : null;
      const current = get();
      // The checkpoint was captured before submit; only attach it when the
      // session is unchanged, so a stale checkpoint cannot enter a
      // replacement game's history.
      const sessionUnchanged =
        current.adapter === adapter && current.gameSessionGeneration === gameSessionGeneration;
      const undoCheckpoint = checkpoint && sessionUnchanged
        ? checkpoint
        : undefined;
      get().commitEngineSnapshot(snapshot, {
        events: result.events,
        logEntries: result.log_entries ?? [],
        undoCheckpoint,
        extraState: { restoredStackAutomation: null },
      });

      if (gameId) void saveAuthoritativeGame(gameId, adapter, snapshot.state);

      return result.events;
    },

    setRewindTargets: (targets) => {
      set({ rewindTargets: targets });
    },

    reset: () => {
      const { adapter } = get();
      if (adapter) {
        adapter.dispose();
      }
      set({ ...initialState, gameSessionGeneration: nextGameSessionGeneration() });
    },

    setAdapter: (adapter) => {
      set({ adapter });
    },

    setGameMode: (mode) => {
      set({ gameMode: mode });
    },



    dismissRestoredStackAutomation: () => {
      set({ restoredStackAutomation: null });
    },

    setManaPaymentPreviewSourceIds: (sourceIds) => {
      set({ manaPaymentPreviewSourceIds: sourceIds });
    },

    clearManaPaymentPreview: () => {
      set({ manaPaymentPreviewSourceIds: [] });
    },

    clearStartingContest: () => {
      set({ startingContest: null });
    },
  })),
);
