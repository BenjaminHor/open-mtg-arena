import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { installChunkReloadHandler } from "../chunkReloadHandler";

const mocks = vi.hoisted(() => ({
  pushUpdateDebug: vi.fn(),
  setUpdateError: vi.fn(),
}));

vi.mock("../updateStatus", () => ({
  pushUpdateDebug: mocks.pushUpdateDebug,
  setUpdateError: mocks.setUpdateError,
}));

const CHUNK_URL = "https://example.test/assets/GamePage-abc.js";
const RELOAD_GUARD_WINDOW_MS = 10 * 60 * 1000;

function firePreloadError(message: string): void {
  const event = new Event("vite:preloadError", { cancelable: true }) as Event & {
    payload?: Error;
  };
  event.payload = new Error(message);
  window.dispatchEvent(event);
}

function firePayloadlessError(): void {
  window.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));
}

function guardEntry(message: string): { count: number; firstAt: number } | null {
  const raw = window.sessionStorage.getItem(`chunk-reload:${message}`);
  return raw ? (JSON.parse(raw) as { count: number; firstAt: number }) : null;
}

describe("chunkReloadHandler loop breaker", () => {
  let reloadSpy: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    installChunkReloadHandler();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    reloadSpy = vi.fn();
    Object.defineProperty(window.location, "reload", {
      value: reloadSpy,
      configurable: true,
    });
  });

  it("reloads on the first two preload errors and counts each reload", () => {
    const message = `Failed to fetch dynamically imported module: ${CHUNK_URL}`;

    firePreloadError(message);
    firePreloadError(message);

    expect(reloadSpy).toHaveBeenCalledTimes(2);
    expect(guardEntry(message)?.count).toBe(2);
    expect(mocks.setUpdateError).not.toHaveBeenCalled();
  });

  it("stops reloading on the third error and surfaces the failure", () => {
    const message = "Failed to fetch dynamically imported module: https://example.test/assets/GamePage-abort.js";

    firePreloadError(message);
    firePreloadError(message);
    firePreloadError(message);

    expect(reloadSpy).toHaveBeenCalledTimes(2);
    expect(mocks.setUpdateError).toHaveBeenCalledTimes(1);
  });

  it("guards payload-less events under the shared unknown key, failing conservative", () => {
    firePayloadlessError();
    firePayloadlessError();
    expect(reloadSpy).toHaveBeenCalledTimes(2);

    firePayloadlessError();

    expect(reloadSpy).toHaveBeenCalledTimes(2);
    expect(mocks.setUpdateError).toHaveBeenCalledTimes(1);
  });

  it("tracks each failing chunk independently", () => {
    const messageA = `Failed to fetch dynamically imported module: ${CHUNK_URL}`;
    const messageB = "Failed to fetch dynamically imported module: https://example.test/assets/DeckPage-def.js";
    window.sessionStorage.setItem(
      `chunk-reload:${messageA}`,
      JSON.stringify({ count: 2, firstAt: Date.now() }),
    );

    firePreloadError(messageB);

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(guardEntry(messageB)?.count).toBe(1);
  });

  it("resets the counter once the guard window has expired", () => {
    const message = `Failed to fetch dynamically imported module: ${CHUNK_URL}`;
    window.sessionStorage.setItem(
      `chunk-reload:${message}`,
      JSON.stringify({ count: 2, firstAt: Date.now() - RELOAD_GUARD_WINDOW_MS - 1000 }),
    );

    firePreloadError(message);

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(guardEntry(message)?.count).toBe(1);
  });

  it("degrades to always-reload when sessionStorage is unavailable", () => {
    const getItem = vi
      .spyOn(window.sessionStorage, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const setItem = vi
      .spyOn(window.sessionStorage, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const message = `Failed to fetch dynamically imported module: ${CHUNK_URL}`;

    firePreloadError(message);
    firePreloadError(message);
    firePreloadError(message);

    expect(reloadSpy).toHaveBeenCalledTimes(3);
    expect(mocks.setUpdateError).not.toHaveBeenCalled();

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
