import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  offline: { value: true },
  feedInit: vi.fn(),
  feedInitializationReady: true,
  deckLibraryAutoSync: vi.fn(),
  migrate: vi.fn(),
  canonicalize: vi.fn(),
  cardStatus: { value: "idle" as string },
}));

vi.mock("../stores/connectivityStore", () => ({
  useEffectiveOffline: () => mocks.offline.value,
}));
vi.mock("../services/deckMigrations", () => ({
  migrateSavedDecks: mocks.migrate,
  canonicalizeSavedDeckNames: mocks.canonicalize,
}));
vi.mock("../stores/cardDataStore", () => ({
  useCardDataStore: (select: (s: { status: string }) => unknown) =>
    select({ status: mocks.cardStatus.value }),
}));
vi.mock("../hooks/useFeedInitialization", () => ({
  useFeedInitialization: (...args: unknown[]) => {
    mocks.feedInit(...args);
    return mocks.feedInitializationReady;
  },
}));
vi.mock("../services/visualPacks/deckLibraryAutoSync", () => ({ useDeckLibraryAutoSync: mocks.deckLibraryAutoSync }));
vi.mock("../startup/preloadAssets", () => ({ ensurePreload: vi.fn(), subscribePreload: () => () => {} }));
vi.mock("../components/chrome/AppShell", () => ({ AppShell: () => null }));
vi.mock("../components/chrome/AppToast", () => ({ AppToast: () => null }));
vi.mock("../components/ErrorBoundary", () => ({ ErrorBoundary: ({ children }: { children: ReactNode }) => children }));
vi.mock("../components/modal/EngineLostModal", () => ({ EngineLostModal: () => null }));
vi.mock("../components/modal/NonFatalPanicToast", () => ({ NonFatalPanicToast: () => null }));
vi.mock("../components/modal/StuckDecisionToast", () => ({ StuckDecisionToast: () => null }));
vi.mock("../components/splash/SplashScreen", () => ({ SplashScreen: () => null }));
vi.mock("../pages/MenuPage", () => ({ MenuPage: () => null }));

import { App } from "../App";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls.length = 0;
  mocks.offline.value = true;
  mocks.feedInitializationReady = true;
  mocks.cardStatus.value = "idle";
  mocks.migrate.mockImplementation(() => mocks.calls.push("migrate"));
  mocks.canonicalize.mockImplementation(() => {
    mocks.calls.push("canonicalize");
    return Promise.resolve();
  });
});

afterEach(() => vi.restoreAllMocks());

describe("App lifecycle", () => {
  it("passes the effective-offline value to feed initialization", () => {
    const view = render(<App />);
    expect(mocks.feedInit).toHaveBeenLastCalledWith(true);

    mocks.offline.value = false;
    act(() => view.rerender(<App />));
    expect(mocks.feedInit).toHaveBeenLastCalledWith(false);
  });

  it("passes the sole offline policy and current feed readiness to deck-library scheduling", () => {
    const view = render(<App />);
    expect(mocks.deckLibraryAutoSync).toHaveBeenLastCalledWith(true, true);

    mocks.offline.value = false;
    mocks.feedInitializationReady = false;
    act(() => view.rerender(<App />));
    expect(mocks.deckLibraryAutoSync).toHaveBeenLastCalledWith(false, false);
  });

  it("migrates saved decks on mount", () => {
    render(<App />);

    expect(mocks.calls).toEqual(["migrate"]);
  });

  it("canonicalizes saved deck names once the card data is ready", () => {
    const view = render(<App />);

    expect(mocks.canonicalize).not.toHaveBeenCalled();

    mocks.cardStatus.value = "ready";
    act(() => view.rerender(<App />));

    expect(mocks.canonicalize).toHaveBeenCalledTimes(1);
    expect(mocks.calls.indexOf("migrate")).toBeLessThan(mocks.calls.indexOf("canonicalize"));
  });
});
