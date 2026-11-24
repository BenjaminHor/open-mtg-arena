import { createStore, del, get, set } from "idb-keyval";

import type {
  EngineAdapter,
  FormatConfig,
  GameState,
  PersistedGameState,
} from "../adapter/types";
import { isCustomGameFormat } from "../adapter/types";
import { formatMetadata } from "../data/formatRegistry";
import { ACTIVE_GAME_CHANGED_EVENT, notifyActiveGameChange } from "./activeGameChange";
import { ACTIVE_GAME_KEY, GAME_CHECKPOINTS_PREFIX, GAME_KEY_PREFIX } from "../constants/storage";

/** Snapshot of an AI seat's configuration at game-start time. `deckId` is read
 *  once, at a fresh game start, to pick the seat's deck (`null` = Random;
 *  absent = fall back to the single-player preferences). After start the
 *  per-seat deck is baked into the engine's persisted `GameState`, so on resume
 *  `deckId` is informational only. `difficulty` is load-bearing at both points:
 *  the AI controller needs it on resume to reconstruct the per-seat policy. */
export interface AiSeatMeta {
  difficulty: string;
  deckId?: string | null;
  deckName?: string | null;
}

export interface ActiveGameMeta {
  id: string;
  mode: "ai" | "local";
  /** Default AI difficulty — retained for back-compat and for 2-player URL
   *  routing. When `aiSeats` is present it is the authoritative per-seat
   *  source; `difficulty` mirrors `aiSeats[0].difficulty`. */
  difficulty: string;
  /** Per-AI-seat config for multi-opponent AI games. Absent for hot-seat
   *  games and for pre-migration saved games. */
  aiSeats?: AiSeatMeta[];
  /** Full setup-time format config for local games that started outside the
   *  dedicated setup page. URL params carry the format name; this preserves
   *  custom knobs like player count limits, starting life, and deck size. */
  formatConfig?: FormatConfig;
}

type LegacyDeckSizeType = "Minimum" | "Exactly";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Resolve the old numeric field's discriminant from engine-authored rules. */
function legacyDeckSizeType(
  formatConfig: Record<string, unknown>,
): LegacyDeckSizeType | undefined {
  const format = formatConfig.format;
  if (typeof format !== "string") return undefined;

  const builtInMetadata = formatMetadata(format as FormatConfig["format"]);
  if (builtInMetadata) return builtInMetadata.default_config.deck_size.type;

  if (!isCustomGameFormat(format)) return undefined;
  const structural = asRecord(asRecord(formatConfig.custom_rules)?.structural);
  const deckSize = asRecord(structural?.deck_size);
  return deckSize?.type === "Minimum" || deckSize?.type === "Exactly"
    ? deckSize.type
    : undefined;
}

/**
 * Convert the pre-Commander-Draft save spelling of FormatConfig.deck_size.
 *
 * Protocol v42 changed this field from a bare number to DeckSizeRule. Network
 * peers are version-gated, but IndexedDB saves survive upgrades and have no
 * protocol handshake to reject them. A legacy local save therefore reached
 * Rust deserialization with e.g. `deck_size: 100` and was discarded by the
 * resume fallback. The engine registry (for built-ins) or persisted engine
 * custom rules supplies the discriminant; without either authority the old
 * value is left untouched so engine restore fails closed rather than guessing.
 */
function normalizeLegacyDeckSizeRule(
  formatConfig: Record<string, unknown>,
): Record<string, unknown> {
  if (!Number.isInteger(formatConfig.deck_size)) return formatConfig;

  const magnitude = formatConfig.deck_size as number;
  const variant = legacyDeckSizeType(formatConfig);
  if (!variant) return formatConfig;
  return {
    ...formatConfig,
    deck_size: { type: variant, data: magnitude },
  };
}

/** Normalize only the persisted state boundary; never mutate the IDB object. */
export function migratePersistedGameState<T extends PersistedGameState>(state: T): T {
  const envelope = "state" in state;
  const gameState = (envelope ? state.state : state) as GameState;
  const formatConfig = gameState.format_config;
  if (!formatConfig || typeof formatConfig !== "object") return state;

  const rawFormatConfig = formatConfig as unknown as Record<string, unknown>;
  const normalized = normalizeLegacyDeckSizeRule(rawFormatConfig);
  if (normalized === rawFormatConfig) return state;

  const nextState = { ...gameState, format_config: normalized as unknown as FormatConfig };
  return (envelope ? { ...state, state: nextState } : nextState) as T;
}

/**
 * Dedicated IndexedDB store for game state persistence.
 * Game state can easily exceed localStorage's ~5MB quota (120+ serialized
 * GameObjects with full ability definitions), so we use IndexedDB which
 * has no practical size limit.
 *
 * ActiveGameMeta remains in localStorage — it's small and benefits from
 * synchronous access for instant menu rendering.
 *
 * The IDB store is lazily created on first use to avoid errors in
 * environments where IndexedDB is unavailable (tests, SSR).
 */
let _gameStore: ReturnType<typeof createStore> | undefined;
const gameWriteQueues = new Map<string, Promise<void>>();

/** Serialize lifecycle writes so a delayed autosave cannot follow a clear. */
async function withGameWriteLock<T>(gameId: string, operation: () => Promise<T>): Promise<T> {
  const previous = gameWriteQueues.get(gameId);
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous ? previous.then(() => next) : next;
  gameWriteQueues.set(gameId, queued);
  // Start the first operation synchronously, matching IndexedDB's usual
  // async-function behavior while still making later same-game writes wait.
  if (previous) await previous;
  try {
    return await operation();
  } finally {
    release();
    if (gameWriteQueues.get(gameId) === queued) gameWriteQueues.delete(gameId);
  }
}

function isTerminalPersistedState(state: PersistedGameState): boolean {
  const publicState = "state" in state ? state.state : state;
  return (
    publicState.match_phase === "Completed"
    || (!publicState.match_phase && publicState.waiting_for.type === "GameOver")
  );
}

function getGameStore(): ReturnType<typeof createStore> {
  if (!_gameStore) {
    _gameStore = createStore("phase-game-state", "phase-game-state");
  }
  return _gameStore;
}

// ── Game State (IndexedDB) ──────────────────────────────────────────────

export async function saveGame(gameId: string, state: PersistedGameState): Promise<void> {
  // A finished game is not resumable; keep the last playable snapshot.
  if (isTerminalPersistedState(state)) return;
  try {
    await withGameWriteLock(gameId, async () => {
      await set(GAME_KEY_PREFIX + gameId, state, getGameStore());
    });
  } catch (err) {
    console.warn("[saveGame] IndexedDB write failed:", err);
  }
}

/**
 * Writes a known-resumable snapshot, failing loudly: a fresh game must not
 * start on a snapshot that could not be saved.
 */
export async function saveResumableGameStrict(
  gameId: string,
  state: PersistedGameState,
): Promise<void> {
  if (isTerminalPersistedState(state)) {
    throw new Error("Refusing to retain a terminal game as resumable state");
  }
  await withGameWriteLock(gameId, async () => {
    await set(GAME_KEY_PREFIX + gameId, state, getGameStore());
  });
}

/**
 * Persist the engine's trusted envelope whenever this adapter owns an engine;
 * adapters that only hold a public remote view retain the legacy raw snapshot.
 */
export async function saveAuthoritativeGame(
  gameId: string,
  adapter: EngineAdapter,
  fallbackState: GameState,
): Promise<void> {
  await saveGame(gameId, await authoritativePersistenceState(adapter, fallbackState));
}

/** Commit the engine-authored initial snapshot before a fresh game can start. */
export async function saveAuthoritativeGameStrict(
  gameId: string,
  adapter: EngineAdapter,
  fallbackState: GameState,
): Promise<void> {
  await saveResumableGameStrict(gameId, await authoritativePersistenceState(adapter, fallbackState));
}

/**
 * Capture the engine-authored trusted envelope for a persistence boundary
 * (saves, undo checkpoints). Rendered screen states are viewer projections
 * (`wire_projection`) that the restore ingress fails closed on, so anything
 * that may later be restored must come from this boundary. Returns null when
 * the adapter holds no local engine — callers push/save nothing restorable
 * rather than an unrestorable projection.
 */
export async function captureTrustedCheckpoint(
  adapter: EngineAdapter,
): Promise<PersistedGameState | null> {
  const trustedJson = await adapter.exportPersistenceState?.();
  return trustedJson ? JSON.parse(trustedJson) as PersistedGameState : null;
}

async function authoritativePersistenceState(
  adapter: EngineAdapter,
  fallbackState: GameState,
): Promise<PersistedGameState> {
  return (await captureTrustedCheckpoint(adapter)) ?? fallbackState;
}

export async function loadGame(gameId: string): Promise<PersistedGameState | null> {
  try {
    const state = await get<PersistedGameState>(GAME_KEY_PREFIX + gameId, getGameStore());
    return state ? migratePersistedGameState(state) : null;
  } catch {
    return null;
  }
}

/** Read a saved game without interpreting an IndexedDB failure as absence. */
export async function loadGameStrict(gameId: string): Promise<PersistedGameState | null> {
  const state = await get<PersistedGameState>(GAME_KEY_PREFIX + gameId, getGameStore());
  return state === undefined ? null : migratePersistedGameState(state);
}

export async function clearGame(gameId: string): Promise<void> {
  const pointer = activeGamePointerToken();
  try {
    await withGameWriteLock(gameId, async () => {
      await del(GAME_KEY_PREFIX + gameId, getGameStore());
      await del(GAME_CHECKPOINTS_PREFIX + gameId, getGameStore());
    });
  } catch { /* best effort */ }
  if (ownsActiveGame(gameId, pointer)) clearActiveGame();
}

/** Remove every game-scoped record before reusing a game ID for a fresh start. */
export async function clearGameStrict(gameId: string): Promise<void> {
  const pointer = activeGamePointerToken();
  await withGameWriteLock(gameId, async () => {
    const store = getGameStore();
    await del(GAME_CHECKPOINTS_PREFIX + gameId, store);
    await del(GAME_KEY_PREFIX + gameId, store);
  });
  if (ownsActiveGame(gameId, pointer)) clearActiveGame();
}

// ── Checkpoints (IndexedDB) ─────────────────────────────────────────────

export async function saveCheckpoints(gameId: string, checkpoints: PersistedGameState[]): Promise<void> {
  try {
    await withGameWriteLock(gameId, async () => {
      await set(GAME_CHECKPOINTS_PREFIX + gameId, checkpoints, getGameStore());
    });
  } catch { /* best effort */ }
}

export async function loadCheckpoints(gameId: string): Promise<PersistedGameState[]> {
  try {
    const checkpoints = await get<PersistedGameState[]>(GAME_CHECKPOINTS_PREFIX + gameId, getGameStore());
    return checkpoints?.map((checkpoint) => migratePersistedGameState(checkpoint)) ?? [];
  } catch {
    return [];
  }
}

// ── Active Game Meta (localStorage — tiny, synchronous) ─────────────────

export { ACTIVE_GAME_CHANGED_EVENT, notifyActiveGameChange };

export function saveActiveGame(meta: ActiveGameMeta): void {
  try {
    localStorage.setItem(ACTIVE_GAME_KEY, JSON.stringify(meta));
    notifyActiveGameChange();
  } catch {
    /* storage denied */
  }
}

export function loadActiveGame(): ActiveGameMeta | null {
  try {
    const raw = localStorage.getItem(ACTIVE_GAME_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ActiveGameMeta;
  } catch {
    return null;
  }
}

export function clearActiveGame(): void {
  try {
    localStorage.removeItem(ACTIVE_GAME_KEY);
    notifyActiveGameChange();
  } catch {
    /* storage denied */
  }
}

/**
 * Clears the active pointer only while it is still the one a consumer read.
 * A pointer written while an async validation was in flight — another game, or
 * this game with a new session — is newer authority and survives. A denied
 * read yields a null token: ownership is then unknown, so nothing is cleared.
 */
export function clearActiveGameIfUnchanged(token: string | null): void {
  if (token === null || activeGamePointerToken() !== token) return;
  clearActiveGame();
}

/** The stored pointer exactly as written: a compare-and-delete token. */
export function activeGamePointerToken(): string | null {
  try {
    return localStorage.getItem(ACTIVE_GAME_KEY);
  } catch {
    return null;
  }
}

/**
 * Whether game cleanup may release the stored pointer: a compare-and-delete
 * against the pointer the cleanup started with. Any pointer written while the
 * cleanup awaited storage — for another game, or for this game ID with a new
 * session — is a replacement and survives.
 */
function ownsActiveGame(gameId: string, startedWith: string | null): boolean {
  if (startedWith === null || activeGamePointerToken() !== startedWith) return false;
  return loadActiveGame()?.id === gameId;
}
