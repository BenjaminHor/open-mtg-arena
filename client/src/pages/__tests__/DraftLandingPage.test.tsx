import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActiveQuickDraftMeta } from "../../services/quickDraftPersistence";
import { useConnectivityStore } from "../../stores/connectivityStore";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  loadActiveQuickDraft: vi.fn<() => ActiveQuickDraftMeta | null>(() => null),
  clearActiveQuickDraft: vi.fn(),
  loadGame: vi.fn(async () => null),
}));

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useNavigate: () => mocks.navigate,
}));

// `ScreenChrome` reaches the chrome controls, which are unrelated to the tile
// grid under test.
vi.mock("../../components/chrome/ScreenChrome", () => ({ ScreenChrome: () => null }));

// The landing page renders a resume card off localStorage; pin the persistence
// reads so no ambient browser state decides what renders.
vi.mock("../../services/quickDraftPersistence", () => ({
  loadActiveQuickDraft: mocks.loadActiveQuickDraft,
  clearActiveQuickDraft: mocks.clearActiveQuickDraft,
}));
vi.mock("../../services/gamePersistence", () => ({ loadGame: mocks.loadGame }));

import { DraftLandingPage } from "../DraftLandingPage";

function quickDraftMeta(overrides: Partial<ActiveQuickDraftMeta> = {}): ActiveQuickDraftMeta {
  return {
    id: "quick-1",
    setCode: "otj",
    difficulty: 2,
    phase: "drafting",
    pickCount: 3,
    updatedAt: Date.now(),
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DraftLandingPage />
    </MemoryRouter>,
  );
}

describe("DraftLandingPage", () => {
  afterEach(() => {
    cleanup();
    useConnectivityStore.setState({ forcedOffline: false, browserOnline: true });
  });

  beforeEach(() => {
    mocks.navigate.mockClear();
    mocks.loadActiveQuickDraft.mockReturnValue(null);
    mocks.clearActiveQuickDraft.mockClear();
    useConnectivityStore.setState({ forcedOffline: false, browserOnline: true });
  });

  it("offers the drafts played against the AI", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /Quick Draft/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith("/draft/quick");
    await user.click(screen.getByRole("button", { name: /Sealed/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith("/draft/quick?mode=sealed");
    await user.click(screen.getByRole("button", { name: /Cube/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith("/draft/quick?mode=cube");
  });

  it("keeps a persisted quick draft resumable while offline", async () => {
    const user = userEvent.setup();
    mocks.loadActiveQuickDraft.mockReturnValue(quickDraftMeta());
    act(() => useConnectivityStore.setState({ forcedOffline: true }));
    renderPage();

    const resume = screen.getByRole("button", { name: /Outlaws of Thunder Junction/ });
    expect(resume).toBeEnabled();
    await user.click(resume);

    expect(mocks.navigate).toHaveBeenCalledWith("/draft/quick?resume=1");
    expect(mocks.clearActiveQuickDraft).not.toHaveBeenCalled();
  });
});
