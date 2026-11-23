import { pushUpdateDebug, setUpdateError } from "./updateStatus";

/**
 * Vite fires `vite:preloadError` when a lazy-imported chunk fails to load —
 * the canonical "user had a tab open across a deploy and the hashed chunk
 * filename changed" case. The service-worker updater handles the *worker*
 * half of post-deploy recovery (new SW activates → reload); this handles
 * the *chunk* half (running JS tries to import a chunk that no longer
 * exists on the server / in the precache → import rejects).
 *
 * Without this listener the user sees a partially-broken UI and must
 * hard-refresh manually. With it, the app self-recovers.
 *
 * Loop breaker: when the failure *persists* (bad cached edge variant,
 * broken client cache), reloading forever would trap the tab in a reload
 * loop. Reloads are counted per failing chunk in `sessionStorage` (survives
 * reload in the same tab; keys self-reset when chunk hashes change on the
 * next deploy). After {@link RELOAD_GUARD_MAX} reloads inside
 * {@link RELOAD_GUARD_WINDOW_MS}, the handler stops reloading and surfaces
 * the failure via `setUpdateError`.
 */
let isInstalled = false;

/** Reloads allowed per failing chunk within {@link RELOAD_GUARD_WINDOW_MS}. */
const RELOAD_GUARD_MAX = 2;
const RELOAD_GUARD_WINDOW_MS = 10 * 60 * 1000;

interface ReloadGuardState {
  count: number;
  firstAt: number;
}

/** Read the guard state for a chunk key; `null` when absent, expired, or
 *  storage is unavailable (lockdown/embedded contexts — the breaker then
 *  degrades to the pre-guard always-reload behavior). */
function readReloadGuard(key: string): ReloadGuardState | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReloadGuardState;
    if (typeof parsed.count !== "number" || typeof parsed.firstAt !== "number") return null;
    if (Date.now() - parsed.firstAt > RELOAD_GUARD_WINDOW_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Count an executed reload (called immediately before `location.reload()`). */
function recordReload(key: string): void {
  try {
    const prior = readReloadGuard(key);
    const next: ReloadGuardState = prior
      ? { count: prior.count + 1, firstAt: prior.firstAt }
      : { count: 1, firstAt: Date.now() };
    window.sessionStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Storage unavailable — degrade to always-reload.
  }
}

export function installChunkReloadHandler(): void {
  if (isInstalled) return;
  isInstalled = true;

  window.addEventListener("vite:preloadError", (event) => {
    // Suppressing the default error keeps the unhandled-rejection out of
    // the console — we're handling it by reloading.
    event.preventDefault();

    // The failed chunk identifier lives in the event's `.payload` Error
    // (its message carries the failing URL). Payload-less events share the
    // "unknown" key deliberately: distinct identity-less failures cross-count
    // toward one breach, which fails conservative (stops reloading) rather
    // than risking a loop.
    const chunk = (event as { payload?: Error }).payload?.message;
    const guardKey = `chunk-reload:${chunk ?? "unknown"}`;

    if ((readReloadGuard(guardKey)?.count ?? 0) >= RELOAD_GUARD_MAX) {
      // Loop breaker: two reloads inside the window didn't fix this chunk, so
      // a third won't either. Stop reloading and tell the user.
      setUpdateError("App update failed to load. Please refresh the page.");
      return;
    }

    pushUpdateDebug("Chunk preload failed; reloading to pick up new bundle.", "warn");
    recordReload(guardKey);
    window.location.reload();
  });
}
