/**
 * DebugPanel's sandbox capabilities: checkpoint restore where this client owns
 * the state, and card spawning by name through the in-browser engine.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DebugPanel } from "../DebugPanel";
import type { GameMode } from "../../../stores/gameStore";

const storeState = {
  gameMode: "ai" as GameMode | null,
  turnCheckpoints: [] as unknown[],
  gameState: null as unknown,
  adapter: null as unknown,
};
const debugDispatch = vi.fn();

vi.mock("../../../stores/gameStore", () => ({
  canExportAuthoritativeState: (mode: GameMode | null) =>
    mode === "ai" || mode === "local",
  useGameStore: Object.assign(
    vi.fn((selector: (s: typeof storeState) => unknown) => selector(storeState)),
    { getState: () => storeState, setState: vi.fn() },
  ),
}));

// `console` shows Turn Checkpoints / Import State; `actions` shows
// DebugActions. Both are exercised below, so the tab is mutable.
const uiState = {
  debugPanelOpen: true,
  debugPanelTab: "console" as "console" | "actions",
  setDebugPanelTab: vi.fn(),
};

vi.mock("../../../stores/uiStore", () => ({
  useUiStore: Object.assign(
    vi.fn((selector: (s: typeof uiState) => unknown) => selector(uiState)),
    { getState: () => uiState, setState: vi.fn() },
  ),
}));

// `usePerspectivePlayerId` is only needed once `CreateCardForm` actually
// renders — its `PlayerSelect`/`ObjectSelect` reach for it. The gated branch
// never does, which is itself evidence the two branches render different
// subtrees rather than the same one with different copy.
vi.mock("../../../hooks/usePlayerId", () => ({
  usePlayerId: () => 0,
  usePerspectivePlayerId: () => 0,
}));
vi.mock("../../../hooks/useGameDispatch", () => ({ useGameDispatch: () => debugDispatch }));
vi.mock("../../../game/dispatch", () => ({ restoreGameState: vi.fn() }));
vi.mock("../../../audio/AudioManager", () => ({
  audioManager: { play: vi.fn(), diagnostics: () => "" },
}));
// `CardNameAutocomplete` fetches the full name list on mount via a build-time
// define that vitest does not provide. Only the ungated branch mounts it, and
// the suggestion list is not what these tests measure — the input's presence
// is.
vi.mock("../../../services/cardNames", () => ({ getCardNames: async () => [] }));

beforeEach(() => {
  storeState.gameMode = "ai";
  storeState.turnCheckpoints = [];
  storeState.gameState = {
    debug_permitted: [0],
    players: [{}, {}],
    format_config: { allow_debug_actions: false },
  };
  uiState.debugPanelTab = "console";
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DebugPanel — sandbox capability", () => {
  it("says why checkpoint restore is unavailable while watching a replay", () => {
    storeState.gameMode = "spectate";

    render(<DebugPanel />);

    expect(screen.getByText("Restore needs the in-browser engine.")).toBeInTheDocument();
  });

  it("still shows the checkpoint notice for browser solo, where restore works", () => {
    // Reach guard for the negative above: with a mode whose adapter DOES
    // implement `restoreState`, the notice is replaced by the empty-state,
    // proving the branch is mode-sensitive rather than always rendering.

    render(<DebugPanel />);

    expect(screen.getByText("No checkpoints yet (saved at turn start)")).toBeInTheDocument();
    expect(screen.queryByText("Restore needs the in-browser engine.")).toBeNull();
  });

  /** Create tab, then the "Create Card" accordion — both start collapsed. */
  function openCreateCardAccordion() {
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    fireEvent.click(screen.getByRole("button", { name: /Create Card/ }));
  }

  function selectBattlefieldZone() {
    fireEvent.click(screen.getByRole("button", { name: "Hand" }));
    fireEvent.click(screen.getByRole("option", { name: "Battlefield" }));
  }

  it("offers card spawning through the in-browser engine", () => {
    uiState.debugPanelTab = "actions";
    storeState.adapter = null;

    render(<DebugPanel />);
    openCreateCardAccordion();

    expect(screen.getByPlaceholderText("Lightning Bolt")).toBeInTheDocument();
    expect(screen.getByLabelText("Make nonlegendary")).toBeInTheDocument();
    expect(screen.queryByLabelText("Create as token")).toBeNull();
    selectBattlefieldZone();
    expect(screen.getByLabelText("Create as token")).toBeInTheDocument();
  });

  it("dispatches the nonlegendary override for a created card", () => {
    uiState.debugPanelTab = "actions";
    storeState.adapter = null;

    render(<DebugPanel />);
    openCreateCardAccordion();

    fireEvent.change(screen.getByPlaceholderText("Lightning Bolt"), {
      target: { value: "Isamaru, Hound of Konda" },
    });
    selectBattlefieldZone();
    fireEvent.click(screen.getByLabelText("Make nonlegendary"));
    fireEvent.click(screen.getByLabelText("Create as token"));
    fireEvent.click(screen.getByRole("button", { name: "Create Card" }));

    expect(debugDispatch).toHaveBeenCalledWith({
      type: "Debug",
      data: {
        type: "CreateCard",
        data: {
          card_name: "Isamaru, Hound of Konda",
          owner: 0,
          zone: "Battlefield",
          attach_to: undefined,
          run_etb: true,
          nonlegendary: true,
          creation_kind: "Token",
          count: 1,
        },
      },
    });
  });
});
