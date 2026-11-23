/**
 * GamePage — cEDH bracket-violation blocking modal tests.
 *
 * The modal renders when GameProvider calls `onNoDeck` with `bracketViolation`
 * set to `true`. GamePage matches by the typed flag — not by string substring
 * on the error message — so a reformatted error message cannot silently break
 * the modal trigger.
 *
 * Heavy sub-components (WASM engine, GameProvider, audio, socket, P2P)
 * are mocked so the suite exercises only the modal render logic and the
 * "Return to setup" navigation.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { MotionGlobalConfig } from "framer-motion";

import { GamePage } from "../GamePage";
import type { FormatConfig } from "../../adapter/types";
import { usePreferencesStore } from "../../stores/preferencesStore";
import { useUiStore } from "../../stores/uiStore";
import { gameObjectFactory } from "../../test/factories/gameObjectFactory";
import {
  buildCommanderFormatConfig,
  gameStateFactory,
} from "../../test/factories/gameStateFactory";

// ── Hoisted variables (must be declared before vi.mock hoisting) ─────────────

// Capture `onNoDeck` from GameProvider so tests can fire it.
let capturedOnNoDeck: ((reason?: string, bracketViolation?: boolean) => void) | undefined;
let capturedFormatConfig: FormatConfig | undefined;
let capturedPile: string | undefined;
let capturedGameId: string | undefined;

const {
  mockCanActForWaitingState,
  mockClearPromptOverlayState,
  mockIsMobile,
  mockSetGameState,
  storeOverrides,
} = vi.hoisted(() => ({
  mockCanActForWaitingState: vi.fn(() => true),
  mockClearPromptOverlayState: vi.fn(),
  mockIsMobile: vi.fn(() => false),
  mockSetGameState: vi.fn(),
  // Mutable slice of the mocked game store. Defaults match the previous
  // hardcoded values, so every pre-existing test is unaffected; tests that
  // need a live adapter assign here and `beforeEach` resets.
  storeOverrides: {
    adapter: null as unknown,
    gameState: null as unknown,
    gameMode: null as unknown,
    waitingFor: null as unknown,
    activationBlockReasons: {} as Record<string, Array<{ ability_index: number; type: string }>>,
  },
}));

// Captures the props GameMenu was rendered with, so tests can assert which
// affordances GamePage decided to offer without rendering the real menu.
let capturedGameMenuProps: Record<string, unknown> | undefined;

const { mockUseMultiplayerStore } = vi.hoisted(() => {
  const mockMultiplayerState = {
    playerNames: new Map<string, string>(),
    playerAvatars: new Map<string, string>(),
  };
  const mockUseMultiplayerStore = Object.assign(
    vi.fn((selector?: (s: typeof mockMultiplayerState) => unknown) =>
      selector ? selector(mockMultiplayerState) : mockMultiplayerState,
    ),
    {
      getState: () => mockMultiplayerState,
      setState: vi.fn(),
    },
  );
  return { mockUseMultiplayerStore };
});

// ── Mock heavy dependencies ──────────────────────────────────────────────────

vi.mock("../../providers/GameProvider", () => ({
  GameProvider: ({
    children,
    gameId,
    onNoDeck,
    formatConfig,
    pile,
  }: {
    children: React.ReactNode;
    gameId: string;
    onNoDeck?: (reason?: string, bracketViolation?: boolean) => void;
    formatConfig?: FormatConfig;
    pile?: string;
  }) => {
    capturedGameId = gameId;
    capturedOnNoDeck = onNoDeck;
    capturedFormatConfig = formatConfig;
    capturedPile = pile;
    return <>{children}</>;
  },
}));

vi.mock("../../game/sessionCleanup.ts", () => ({
  clearPromptOverlayState: mockClearPromptOverlayState,
}));

// useGameDispatch moved out of GameProvider into its own hook module; mock it
// at the real location.
vi.mock("../../hooks/useGameDispatch.ts", () => ({
  useGameDispatch: () => vi.fn(),
}));

// game/dispatch.ts runs a module-level `captureSnapshot()` (dispatch.ts:44)
// that touches `document` at import. GamePage's subtree reaches it via
// ActionButton, and collection evaluates that import before the happy-dom
// environment is ready — so mock the whole module (matching the convention in
// ActionButton.test.tsx). All exports are stubbed since this test exercises
// the bracket-violation modal, not action dispatch.
vi.mock("../../game/dispatch.ts", () => ({
  dispatchAction: vi.fn(),
  dispatchResolveAll: vi.fn(),
  processRemoteUpdate: vi.fn(),
  restoreGameState: vi.fn(),
  currentSnapshot: new Map(),
}));

vi.mock("../../stores/gameStore", async () => {
  const snapshot = (): Record<string, unknown> => ({
    gameState: storeOverrides.gameState,
    gameMode: storeOverrides.gameMode,
    waitingFor: storeOverrides.waitingFor,
    legalActions: [],
    endContinuousEffectOffers: [],
    autoPassRecommended: false,
    spellCosts: {},
    legalActionsByObject: {},
    // CR 118.3: the acting-player "can't pay this cost right now" read-out.
    // Mutable so a test can seed it; reset in `beforeEach` alongside the
    // other `storeOverrides` fields.
    activationBlockReasons: storeOverrides.activationBlockReasons,
    events: [],
    eventHistory: [],
    logHistory: [],
    adapter: storeOverrides.adapter,
  });
  return {
    useGameStore: Object.assign(
      vi.fn((selector: (s: Record<string, unknown>) => unknown) => selector(snapshot())),
      // The real `useKeyboardShortcuts` listener reads the store imperatively.
      { getState: snapshot, setState: mockSetGameState },
    ),
    clearGame: vi.fn(),
    // The real predicates: `useGameStore` stays the mock above, so the real
    // zustand store is imported but never rendered against.
    canExportAuthoritativeState: (
      await vi.importActual<typeof import("../../stores/gameStore")>("../../stores/gameStore")
    ).canExportAuthoritativeState,
    // The real census key: seat derivation must not be re-derived as a mode
    // list here, or the test would pass while production classified a mode
    // differently.
    seatSource: (
      await vi.importActual<typeof import("../../stores/gameStore")>("../../stores/gameStore")
    ).seatSource,
    loadActiveGame: vi.fn(() => null),
    saveActiveGame: vi.fn(),
    clearActiveGame: vi.fn(),
    loadGame: vi.fn(() => Promise.resolve(null)),
    loadCheckpoints: vi.fn(() => Promise.resolve([])),
  };
});

// The factory stays SYNCHRONOUS: an async factory reorders module evaluation
// so the real dispatch.ts top-level `captureSnapshot()` runs before the
// happy-dom environment is ready (`document is not defined`).
vi.mock("../../stores/multiplayerStore", () => ({
  useMultiplayerStore: mockUseMultiplayerStore,
  getOpponentDisplayName: (playerId: number) => `Opponent ${playerId + 1}`,
  getPlayerDisplayName: (playerId: number) => `Player ${playerId + 1}`,
}));

vi.mock("../../hooks/usePlayerId", () => ({
  usePlayerId: () => 0,
  usePerspectivePlayerId: () => 0,
  useCanActForWaitingState: mockCanActForWaitingState,
  // useTurnStatus (reached via the mounted <TurnStatusLine/>) also imports
  // waitingPlayer from this module; the whole module is mocked, so it must be
  // re-declared or the call throws. gameStore is mocked with waitingFor: null,
  // for which the real waitingPlayer returns null — mirror that here.
  waitingPlayer: () => null,
  // The mounted priority-attention controller reaches `shouldAutoPass`, which
  // reads the local seat through `getPlayerId`.
  getPlayerId: () => 0,
}));

vi.mock("../../hooks/useIsMobile", () => ({
  useIsMobile: () => mockIsMobile(),
  useIsCompactHeight: () => false,
}));

vi.mock("../../audio/useAudioContext", () => ({
  useAudioContext: () => undefined,
}));

vi.mock("../../hooks/useGameplayPreferencesSync", () => ({
  useGameplayPreferencesSync: () => undefined,
}));

vi.mock("../../components/board/BattlefieldBackground", () => ({
  BattlefieldBackground: () => null,
}));

vi.mock("../../components/stack/StackDisplay", () => ({
  StackDisplay: () => null,
}));



vi.mock("../../components/board/GameBoard", () => ({
  GameBoard: (props: Record<string, unknown>) => {
    return (
      <div
        data-layout={String(props.effectiveMultiplayerBoardLayout)}
        data-testid="game-board-layout"
      />
    );
  },
}));

vi.mock("../../components/hand/PlayerHand", () => ({
  PlayerHand: ({ interactionDisabled = false }: { interactionDisabled?: boolean }) => (
    <div
      data-interaction-disabled={String(interactionDisabled)}
      data-testid="player-hand-gate"
    />
  ),
}));

vi.mock("../../components/hand/MobileHandDrawer", () => ({
  MobileHandDrawer: ({ interactionDisabled = false }: { interactionDisabled?: boolean }) => (
    <div
      data-interaction-disabled={String(interactionDisabled)}
      data-testid="mobile-hand-drawer-gate"
    />
  ),
}));

vi.mock("../../components/modal/EngineLostModal", () => ({
  EngineLostModal: () => null,
}));

vi.mock("../../components/modal/CardDataMissingModal", () => ({
  CardDataMissingModal: () => null,
}));

// This is the leaf of the production ability-choice path. Keeping the mock at
// the rendering boundary lets the test exercise GamePage's module-private
// AbilityChoiceModal and observe the actual labels it supplies without pulling
// card-art loading into a label-wiring test.
// `onChoose` is wired through and called UNCONDITIONALLY — deliberately WITHOUT
// re-implementing the real `ChoiceModal`'s `opt.disabled` guard. That guard is
// tested against the real component in
// `components/modal/__tests__/ChoiceModal.test.tsx`; mirroring it here would
// make GamePage's OWN `blocked:` / `!action` guard unreachable, and this mock
// exists precisely so a `blocked:` id can reach it.
vi.mock("../../components/modal/ChoiceModal", () => ({
  ChoiceModal: ({
    options,
    onChoose,
  }: {
    options: Array<{ id: string; label: string; description?: string; disabled?: boolean }>;
    onChoose: (id: string) => void;
  }) => (
    <div data-testid="ability-choice-options">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          data-option-id={option.id}
          data-option-description={option.description}
          data-option-disabled={option.disabled ? "true" : undefined}
          onClick={() => onChoose(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("../../stores/draftStore", () => ({
  useDraftStore: vi.fn(() => ({
    phase: "idle",
    pool: [],
    picks: [],
    packs: [],
    currentPack: null,
    currentPickIndex: 0,
    draftComplete: false,
  })),
}));

vi.mock("../../services/quickDraftPersistence", () => ({
  loadActiveQuickDraft: vi.fn(() => null),
  saveQuickDraftRun: vi.fn(),
  deleteQuickDraftRun: vi.fn(),
}));

// Spreads the real module: `draft-adapter` exports the `DRAFT_KINDS` tuple
// that `draftPersistence`'s kind guard folds at module scope, so a total
// factory breaks every importer in this graph. Its top level is types plus a
// DYNAMIC `import("@wasm/draft")`, so importing it loads no wasm.
vi.mock("../../adapter/draft-adapter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../adapter/draft-adapter")>()),
  createDraftAdapter: vi.fn(),
}));

vi.mock("../../components/chrome/GameMenu", () => ({
  GameMenu: (props: Record<string, unknown>) => {
    capturedGameMenuProps = props;
    return (
      <button
        ref={props.menuTriggerRef as React.Ref<HTMLButtonElement> | undefined}
        type="button"
      >
        Game menu
      </button>
    );
  },
}));

let capturedConcedeDialogProps: Record<string, unknown> | undefined;
vi.mock("../../components/multiplayer/ConcedeDialog", () => ({
  ConcedeDialog: (props: Record<string, unknown>) => {
    capturedConcedeDialogProps = props;
    return null;
  },
}));

vi.mock("../../hooks/useCardDataMeta", () => ({
  useCardDataMeta: () => null,
  formatRelativeDate: () => "",
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Renders whatever router state the deck-rejected re-entry navigated with,
 * so a dropped field is visible rather than inferred. */
function MultiplayerStub() {
  const { state } = useLocation();
  return <div data-testid="multiplayer-stub">{JSON.stringify(state)}</div>;
}

function gamePageTree(
  initialEntry: string | { pathname: string; search: string; state: unknown } =
    "/game/test-game-123?mode=ai",
) {
  return (
    <MemoryRouter initialEntries={[initialEntry as never]}>
      <Routes>
        <Route path="/game/:id" element={<GamePage />} />
        <Route path="/setup" element={<div data-testid="setup-page">Setup</div>} />
        <Route path="/multiplayer" element={<MultiplayerStub />} />
        <Route path="/" element={<div>Home</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function renderGamePage(
  initialEntry: string | { pathname: string; search: string; state: unknown } =
    "/game/test-game-123?mode=ai",
) {
  return render(gamePageTree(initialEntry));
}

async function closePreferencesAndExpectGameMenuFocus(): Promise<void> {
  const dialog = await screen.findByRole("dialog", { name: "Settings" });
  await closeDialogAndExpectGameMenuFocus(dialog);
}

async function closeDialogAndExpectGameMenuFocus(
  dialog: HTMLElement,
): Promise<void> {
  await closeDialogAndExpectFocus(
    dialog,
    screen.getByRole("button", { name: "Game menu" }),
  );
}

async function closeDialogAndExpectFocus(
  dialog: HTMLElement,
  returnTarget: HTMLElement,
): Promise<void> {
  await waitFor(() => expect(dialog).toHaveFocus());
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() =>
    expect(dialog).not.toBeInTheDocument(),
  );
  expect(returnTarget).toHaveFocus();
}

// ── Test suite ────────────────────────────────────────────────────────────────

beforeEach(() => {
  capturedOnNoDeck = undefined;
  capturedFormatConfig = undefined;
  capturedGameId = undefined;
  capturedGameMenuProps = undefined;
  storeOverrides.adapter = null;
  storeOverrides.gameState = null;
  storeOverrides.gameMode = null;
  storeOverrides.waitingFor = null;
  storeOverrides.activationBlockReasons = {};
  useUiStore.setState({ pendingAbilityChoice: null });
  mockIsMobile.mockReturnValue(false);
  usePreferencesStore.setState({
    multiplayerBoardLayout: "focused",
    multiplayerSplitLayoutNudgeDismissed: true,
  });
  capturedConcedeDialogProps = undefined;
  vi.clearAllMocks();
  mockCanActForWaitingState.mockReturnValue(true);
});

afterEach(() => {
  cleanup();
});

describe("GamePage — cEDH bracket-violation blocking modal", () => {

  it("passes Two-Headed Giant to GameProvider for a direct local URL", () => {
    renderGamePage("/game/test-game-123?format=TwoHeadedGiant&players=4");

    expect(capturedFormatConfig?.format).toBe("TwoHeadedGiant");
  });

  it("passes Two-Headed Giant to GameProvider for a direct AI URL", () => {
    renderGamePage("/game/test-game-123?mode=ai&format=TwoHeadedGiant&players=4");

    expect(capturedFormatConfig?.format).toBe("TwoHeadedGiant");
  });

  it("hands the URL's pile to GameProvider", () => {
    renderGamePage("/game/test-game-123?mode=ai&format=Dandan&pile=Pile%20A");
    expect(capturedPile).toBe("Pile A");
    cleanup();

    renderGamePage("/game/test-game-123?mode=ai&format=Dandan");
    expect(capturedPile).toBeUndefined();
  });

  it("passes Planechase to GameProvider for a direct local URL", () => {
    renderGamePage("/game/test-game-123?format=Planechase&players=4");

    expect(capturedFormatConfig?.format).toBe("Planechase");
  });

  it("passes Planechase Commander to GameProvider for a direct local URL", () => {
    renderGamePage("/game/test-game-123?format=PlanechaseCommander&players=4");

    expect(capturedFormatConfig?.format).toBe("PlanechaseCommander");
  });

  // The setup screen hands its edited config over on the navigation rather than
  // in the URL, which carries the format NAME only. Without this the memo falls
  // back to the format registry and a custom starting life is silently replaced
  // by the format default — including on the Tauri native route, which writes no
  // resume pointer and so has no other copy of the user's choice.
  it("prefers the setup screen's handed-over config over the format default", () => {
    renderGamePage({
      pathname: "/game/test-game-123",
      search: "?mode=ai&format=Commander&players=2",
      state: { formatConfig: { format: "Commander", starting_life: 25 } },
    });

    expect(capturedFormatConfig?.starting_life).toBe(25);
  });

  it("renders the blocking modal when bracketViolation flag is true", async () => {
    renderGamePage();

    // Simulate GameProvider calling onNoDeck with bracketViolation=true.
    // The modal must trigger on the typed flag, not on string substring.
    act(() => {
      capturedOnNoDeck?.(
        "Deck validation failed: seat 0 is not declared cEDH (actual tier: core)",
        true,
      );
    });

    const modal = await screen.findByTestId("bracket-violation-modal");
    expect(modal).toBeTruthy();
    expect(modal).toHaveTextContent(/Return to setup/i);
  });

  it("does NOT render the bracket-violation modal when bracketViolation flag is absent", () => {
    renderGamePage();

    // Same message text as above but no bracketViolation flag.
    // The modal must NOT trigger — string substring must not be the gate.
    act(() => {
      capturedOnNoDeck?.(
        "Deck validation failed: seat 0 is not declared cEDH (actual tier: core)",
        // bracketViolation intentionally omitted
      );
    });

    expect(screen.queryByTestId("bracket-violation-modal")).toBeNull();
  });

  it("does NOT render the bracket-violation modal for unrelated engine errors", () => {
    renderGamePage();

    act(() => {
      capturedOnNoDeck?.("Deck validation failed: Forest is not legal in Standard");
    });

    expect(screen.queryByTestId("bracket-violation-modal")).toBeNull();
  });

  it("does NOT render the bracket-violation modal when no error is present", () => {
    renderGamePage();
    expect(screen.queryByTestId("bracket-violation-modal")).toBeNull();
  });

  it("navigates to /setup when the 'Return to setup' button is clicked", async () => {
    const user = userEvent.setup();
    renderGamePage();

    act(() => {
      capturedOnNoDeck?.(
        "Deck validation failed: seat 1 is not declared cEDH (actual tier: optimized)",
        true,
      );
    });

    const button = await screen.findByRole("button", { name: /return to setup/i });
    await user.click(button);

    // After clicking, the modal should be gone and /setup rendered.
    expect(screen.queryByTestId("bracket-violation-modal")).toBeNull();
    expect(await screen.findByTestId("setup-page")).toBeTruthy();
  });

  // ── Regression: bracket-5 human deck vs non-cEDH AI must be allowed ────────

  it("REGRESSION: bracketViolation=false with a bracket-5 message does not show modal", () => {
    renderGamePage();

    // This is the regression case: a bracket-5 user deck playing against
    // Easy/Hard AI should never trigger the bracket-violation modal.
    // GameProvider will pass bracketViolation=false (or omit it), so even
    // if the error message mentions cEDH, the modal must not fire.
    act(() => {
      capturedOnNoDeck?.(
        "Deck validation failed: some other error",
        false,
      );
    });

    expect(screen.queryByTestId("bracket-violation-modal")).toBeNull();
  });
});

describe("GamePage — Room unlock labels", () => {
  it("passes copied Room half identities into its private ability-choice consumer", () => {
    const roomCopy = gameObjectFactory
      .enchantment()
      .onBattlefield()
      .withId(8294)
      .named("")
      .build();
    const gameState = gameStateFactory
      .withPlayers(0, 1)
      .withObjects(roomCopy)
      .priority(0)
      .build({
        derived: {
          room_half_identities: {
            [String(roomCopy.id)]: {
              left: { name: "Greenhouse", mana_cost: { type: "Cost", generic: 2, shards: ["Green"] } },
              right: { name: "Rickety Gazebo", mana_cost: { type: "Cost", generic: 3, shards: ["Green"] } },
            },
          },
        },
      });
    storeOverrides.gameState = gameState;
    storeOverrides.waitingFor = gameState.waiting_for;
    useUiStore.setState({
      pendingAbilityChoice: {
        objectId: roomCopy.id,
        actions: [
          { type: "UnlockRoomDoor", data: { object_id: roomCopy.id, door: "Left" } },
          { type: "UnlockRoomDoor", data: { object_id: roomCopy.id, door: "Right" } },
        ],
      },
    });

    renderGamePage();

    expect(screen.getByRole("button", { name: "Unlock Greenhouse ({2}{G})" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlock Rickety Gazebo ({3}{G})" })).toBeInTheDocument();
  });
});

describe("GamePage — CR 118.3 unaffordable-ability rows in the ability picker", () => {
  const ENGINE_ID = 9301 as const;
  // Index 0 is OFFERED (an action row); index 1 is WITHHELD by the engine
  // because its cost is unpayable right now, and is the row this feature adds.
  const OFFERED_DESC = "{1}: Draw a card.";
  const BLOCKED_DESC = "{7}: Search your library for a Sliver card.";
  // The localized reason lands in the row's `description`, which this file's
  // `ChoiceModal` mock deliberately does not render: appending it inside the
  // <button> would change the accessible names the Room-unlock test above
  // asserts on. The reason text is covered against the REAL component in
  // `components/modal/__tests__/ChoiceModal.test.tsx` (rows 15/16).

  /** Seed a board whose picker is open on `ENGINE_ID` with one offered ability. */
  function seedPicker(activationBlockReasons: Record<string, Array<{ ability_index: number; type: string }>>) {
    const engine = gameObjectFactory
      .creature(2, 2)
      .onBattlefield()
      .withId(ENGINE_ID)
      .ownedBy(0)
      .named("Costly Engine")
      .build({
        abilities: [
          { description: OFFERED_DESC },
          { description: BLOCKED_DESC },
        ] as never,
      });
    const gameState = gameStateFactory
      .withPlayers(0, 1)
      .withObjects(engine)
      .priority(0)
      .build();
    storeOverrides.gameState = gameState;
    storeOverrides.waitingFor = gameState.waiting_for;
    storeOverrides.activationBlockReasons = activationBlockReasons;
    useUiStore.setState({
      pendingAbilityChoice: {
        objectId: ENGINE_ID,
        actions: [
          { type: "ActivateAbility", data: { source_id: ENGINE_ID, ability_index: 0 } },
        ],
      },
    });
    renderGamePage();
  }

  /** Every option button the private `AbilityChoiceModal` supplied, in DOM order. */
  function optionIds(): string[] {
    return Array.from(
      screen.getByTestId("ability-choice-options").querySelectorAll("button"),
    ).map((b) => b.getAttribute("data-option-id") ?? "");
  }

  function optionLabels(): string[] {
    return Array.from(
      screen.getByTestId("ability-choice-options").querySelectorAll("button"),
    ).map((b) => b.textContent ?? "");
  }

  /**
   * Select by the option's ID, not by its accessible name. `abilityChoiceLabel`
   * splits an ActivateAbility description at the colon (the offered row renders
   * as `{1}`, not the whole sentence), and most rows here are not about that
   * formatting — binding to it would make the test fail for an unrelated
   * viewmodel change. The one row that IS about it asserts the split explicitly.
   */
  function optionButton(id: string): HTMLElement {
    const el = screen
      .getByTestId("ability-choice-options")
      .querySelector(`[data-option-id="${id}"]`);
    expect(el, `option ${id} must be rendered`).not.toBeNull();
    return el as HTMLElement;
  }

  // Row 17 (a) — THE USER-VISIBLE HALF OF THE FIX. The reported defect was that
  // an ability the engine withholds for cost simply vanished from the picker.
  // The blocked row must be appended AFTER the action rows, because the offered
  // rows' ids are positional (`String(i)` <-> `pending.actions[Number(id)]`) and
  // prepending would silently re-index every dispatch.
  it("appends a non-selectable row per withheld ability, after the offered rows", () => {
    seedPicker({ [String(ENGINE_ID)]: [{ ability_index: 1, type: "CostNotPayableNow" }] });

    // The load-bearing claim: the blocked row exists, and it is LAST.
    expect(optionIds()).toEqual(["0", "blocked:1"]);
    // The blocked row uses the SAME label/description split as the offered rows
    // (`abilityLabel` + `stripCostPrefix`), so the bold line is the cost pip on
    // both and the two are visually comparable in one list — the comparison the
    // reported defect is about. Asserting the split, not just "some label".
    expect(optionLabels()[1]).toBe("{7}");
    expect(optionButton("blocked:1")).toHaveAttribute(
      "data-option-description",
      "Search your library for a Sliver card. — You can't pay this cost right now",
    );
    // PAIRED POSITIVE for the convention itself: the OFFERED row's label is a
    // bare cost too, so the assertion above pins a shared shape rather than a
    // coincidence of this fixture.
    expect(optionLabels()[0]).toBe("{1}");
    expect(optionButton("blocked:1")).toHaveAttribute("data-option-disabled", "true");
    // PAIRED POSITIVE, mandatory: the offered row is NOT disabled, so a modal
    // that disabled everything cannot satisfy the assertion above.
    expect(optionButton("0")).not.toHaveAttribute("data-option-disabled");
  });

  // Row 17 (b) — the empty-read-out control. With no withheld abilities the
  // picker is byte-for-byte what it was before this feature, so the change is
  // additive rather than a rewrite of the option list.
  it("adds no rows when the engine withholds nothing", () => {
    seedPicker({});

    expect(optionIds()).toEqual(["0"]);
  });

  // Row 17 (c) — GamePage's OWN dispatch guard, reached through the real
  // `onChoose`. `setPending(null)` is the observable: a chosen action clears
  // `pendingAbilityChoice`, so "the picker stays open" is the signal that the
  // guard refused the id. `useUiStore` is the real store here, not a mock.
  it("refuses to dispatch a blocked row's id while still dispatching a real one", () => {
    seedPicker({ [String(ENGINE_ID)]: [{ ability_index: 1, type: "CostNotPayableNow" }] });

    fireEvent.click(optionButton("blocked:1"));
    expect(
      useUiStore.getState().pendingAbilityChoice,
      "clicking a blocked row must not resolve the choice",
    ).not.toBeNull();

    // PAIRED POSITIVE, mandatory: the SAME handler in the SAME render does
    // resolve the choice for a real action row, so the refusal above is a
    // refusal and not a dead modal.
    fireEvent.click(optionButton("0"));
    expect(
      useUiStore.getState().pendingAbilityChoice,
      "clicking an offered row must resolve the choice",
    ).toBeNull();
  });
});

describe("GamePage — multiplayer board layout during board choices", () => {
  it("disables both hand surfaces only for the authorized local board choice actor", () => {
    const untapCandidate = gameObjectFactory
      .creature(2, 2)
      .onBattlefield()
      .tapped()
      .withId(10)
      .ownedBy(0)
      .build();
    const stateForActor = (player: number) => gameStateFactory
      .withPlayers(0, 1)
      .withObjects(untapCandidate)
      .untapChoice({ player, candidates: [untapCandidate.id] })
      .build();
    mockCanActForWaitingState.mockImplementation(() => {
      const waitingFor = storeOverrides.waitingFor as { data?: { player?: number } } | null;
      return waitingFor?.data?.player === 0;
    });

    const localChoice = stateForActor(0);
    storeOverrides.gameState = localChoice;
    storeOverrides.waitingFor = localChoice.waiting_for;
    const view = renderGamePage();

    expect(screen.getByTestId("player-hand-gate")).toHaveAttribute(
      "data-interaction-disabled",
      "true",
    );
    expect(screen.getByTestId("mobile-hand-drawer-gate")).toHaveAttribute(
      "data-interaction-disabled",
      "true",
    );

    const opponentChoice = stateForActor(1);
    storeOverrides.gameState = opponentChoice;
    storeOverrides.waitingFor = opponentChoice.waiting_for;
    view.rerender(gamePageTree());

    expect(screen.getByTestId("player-hand-gate")).toHaveAttribute(
      "data-interaction-disabled",
      "false",
    );
    expect(screen.getByTestId("mobile-hand-drawer-gate")).toHaveAttribute(
      "data-interaction-disabled",
      "false",
    );
  });

  it("forces split visibility for an authorized untap choice at a three-player table", () => {
    mockIsMobile.mockReturnValue(true);
    const untapCandidate = gameObjectFactory
      .creature(2, 2)
      .onBattlefield()
      .tapped()
      .withId(10)
      .ownedBy(0)
      .build();
    const gameState = gameStateFactory
      .withPlayers(0, 1, 2)
      .withObjects(untapCandidate)
      .untapChoice({ player: 0, candidates: [untapCandidate.id] })
      .build();
    storeOverrides.gameState = gameState;
    storeOverrides.waitingFor = gameState.waiting_for;

    renderGamePage();

    expect(screen.getByTestId("game-board-layout")).toHaveAttribute("data-layout", "split");
    expect(capturedGameMenuProps?.multiplayerBoardLayout).toBeUndefined();
    expect(capturedGameMenuProps?.showMultiplayerSplitLayoutNudge).toBe(false);
  });

  it("retains the persisted focused layout for a non-untap waiting state", () => {
    const permanent = gameObjectFactory
      .creature(2, 2)
      .onBattlefield()
      .withId(10)
      .ownedBy(0)
      .build();
    const gameState = gameStateFactory
      .withPlayers(0, 1, 2)
      .withObjects(permanent)
      .priority(0)
      .build();
    storeOverrides.gameState = gameState;
    storeOverrides.waitingFor = gameState.waiting_for;

    renderGamePage();

    expect(screen.getByTestId("game-board-layout")).toHaveAttribute("data-layout", "focused");
  });

  it("honors an explicit split preference on mobile outside an untap choice", () => {
    mockIsMobile.mockReturnValue(true);
    usePreferencesStore.setState({ multiplayerBoardLayout: "split" });
    const permanent = gameObjectFactory
      .creature(2, 2)
      .onBattlefield()
      .withId(10)
      .ownedBy(0)
      .build();
    const gameState = gameStateFactory
      .withPlayers(0, 1, 2)
      .withObjects(permanent)
      .priority(0)
      .build();
    storeOverrides.gameState = gameState;
    storeOverrides.waitingFor = gameState.waiting_for;

    renderGamePage();

    expect(screen.getByTestId("game-board-layout")).toHaveAttribute("data-layout", "split");
  });

  it.each([
    ["mobile", true, "focused"],
    ["desktop", false, "split"],
  ] as const)("resolves the auto layout for a %s viewport", (_viewport, isMobile, layout) => {
    mockIsMobile.mockReturnValue(isMobile);
    usePreferencesStore.setState({ multiplayerBoardLayout: "auto" });
    const gameState = gameStateFactory.withPlayers(0, 1, 2).priority(0).build();
    storeOverrides.gameState = gameState;
    storeOverrides.waitingFor = gameState.waiting_for;

    renderGamePage();

    expect(screen.getByTestId("game-board-layout")).toHaveAttribute("data-layout", layout);
    expect(capturedGameMenuProps?.multiplayerBoardLayout).toBe(layout);
  });

  it.each([
    ["mobile", true, "focused", "split"],
    ["desktop", false, "split", "focused"],
  ] as const)(
    "writes the opposite explicit choice when toggling auto on %s",
    (_viewport, isMobile, displayedLayout, expectedPreference) => {
      mockIsMobile.mockReturnValue(isMobile);
      usePreferencesStore.setState({ multiplayerBoardLayout: "auto" });
      const gameState = gameStateFactory.withPlayers(0, 1, 2).priority(0).build();
      storeOverrides.gameState = gameState;
      storeOverrides.waitingFor = gameState.waiting_for;

      renderGamePage();

      expect(capturedGameMenuProps?.multiplayerBoardLayout).toBe(displayedLayout);
      act(() => (capturedGameMenuProps?.onToggleMultiplayerBoardLayout as () => void)());
      expect(usePreferencesStore.getState().multiplayerBoardLayout).toBe(expectedPreference);
    },
  );

  it("offers the wide focused-layout nudge without writing preferences on render", () => {
    const permanent = gameObjectFactory
      .creature(2, 2)
      .onBattlefield()
      .withId(10)
      .ownedBy(0)
      .build();
    const gameState = gameStateFactory
      .withPlayers(0, 1, 2)
      .withObjects(permanent)
      .priority(0)
      .build();
    storeOverrides.gameState = gameState;
    storeOverrides.waitingFor = gameState.waiting_for;
    usePreferencesStore.setState({
      multiplayerBoardLayout: "focused",
      multiplayerSplitLayoutNudgeDismissed: false,
    });

    renderGamePage();

    expect(capturedGameMenuProps?.showMultiplayerSplitLayoutNudge).toBe(true);
    expect(usePreferencesStore.getState().multiplayerBoardLayout).toBe("focused");
    expect(usePreferencesStore.getState().multiplayerSplitLayoutNudgeDismissed).toBe(false);

    act(() => (capturedGameMenuProps?.onTryMultiplayerSplitLayout as () => void)());
    expect(usePreferencesStore.getState().multiplayerBoardLayout).toBe("split");
    expect(usePreferencesStore.getState().multiplayerSplitLayoutNudgeDismissed).toBe(false);
  });

  it("dismisses the nudge without changing the raw layout", () => {
    const gameState = gameStateFactory.withPlayers(0, 1, 2).priority(0).build();
    storeOverrides.gameState = gameState;
    storeOverrides.waitingFor = gameState.waiting_for;
    usePreferencesStore.setState({
      multiplayerBoardLayout: "focused",
      multiplayerSplitLayoutNudgeDismissed: false,
    });

    renderGamePage();

    act(() => (capturedGameMenuProps?.onDismissMultiplayerSplitLayoutNudge as () => void)());

    expect(usePreferencesStore.getState().multiplayerBoardLayout).toBe("focused");
    expect(usePreferencesStore.getState().multiplayerSplitLayoutNudgeDismissed).toBe(true);
  });

  it.each([
    ["mobile", true, "focused", false],
    ["raw split", false, "split", false],
    ["dismissed focused", false, "focused", true],
  ] as const)(
    "withholds the nudge for a %s cohort",
    (_cohort, isMobile, multiplayerBoardLayout, multiplayerSplitLayoutNudgeDismissed) => {
      const gameState = gameStateFactory.withPlayers(0, 1, 2).priority(0).build();
      storeOverrides.gameState = gameState;
      storeOverrides.waitingFor = gameState.waiting_for;
      mockIsMobile.mockReturnValue(isMobile);
      usePreferencesStore.setState({
        multiplayerBoardLayout,
        multiplayerSplitLayoutNudgeDismissed,
      });

      renderGamePage();

      expect(capturedGameMenuProps?.showMultiplayerSplitLayoutNudge).toBe(false);
      expect(capturedGameMenuProps?.onTryMultiplayerSplitLayout).toBeUndefined();
    },
  );
});

describe("GamePage — board settings focus handoff", () => {
  it("returns Change Background from its transient menu to the game menu", async () => {
    renderGamePage();
    fireEvent.contextMenu(screen.getByTestId("game-board-layout"), {
      clientX: 40,
      clientY: 60,
    });

    fireEvent.click(screen.getByRole("menuitem", { name: /Change background/ }));

    await closePreferencesAndExpectGameMenuFocus();
  });
});

describe("GamePage — shared modal return targets", () => {
  it("returns a manually opened zone viewer to its persistent pile", async () => {
    const card = gameObjectFactory
      .withId(71)
      .named("Graveyard Card")
      .ownedBy(0)
      .inGraveyard()
      .build();
    storeOverrides.gameState = gameStateFactory
      .withPlayers({ id: 0, graveyard: [card.id] }, 1)
      .withObjects(card)
      .build();
    renderGamePage();
    const pile = document.querySelector<HTMLButtonElement>(
      '[data-graveyard-pile="0"]',
    );
    expect(pile).not.toBeNull();
    screen.getByRole("button", { name: "Game menu" }).focus();
    fireEvent.click(pile!);

    await closeDialogAndExpectFocus(
      await screen.findByRole("dialog", { name: /Graveyard/ }),
      pile!,
    );
  });

  it("falls back to the game menu when the final card leaves an open zone", async () => {
    const card = gameObjectFactory
      .withId(72)
      .named("Last Graveyard Card")
      .ownedBy(0)
      .inGraveyard()
      .build();
    storeOverrides.gameState = gameStateFactory
      .withPlayers({ id: 0, graveyard: [card.id] }, 1)
      .withObjects(card)
      .build();
    const view = renderGamePage();
    const pile = document.querySelector<HTMLButtonElement>(
      '[data-graveyard-pile="0"]',
    );
    expect(pile).not.toBeNull();
    fireEvent.click(pile!);
    const dialog = await screen.findByRole("dialog", { name: /Graveyard/ });
    await waitFor(() => expect(dialog).toHaveFocus());

    storeOverrides.gameState = gameStateFactory.withPlayers(0, 1).build();
    view.rerender(gamePageTree());
    expect(pile).not.toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Game menu" })).toHaveFocus();
  });

  it("falls back when a visible library launcher remains mounted but disables", async () => {
    const visibleTop = gameObjectFactory
      .withId(73)
      .named("Visible Library Top")
      .ownedBy(0)
      .params({
        zone: "Library",
        display_visible_to_viewer: true,
        entered_battlefield_turn: null,
      })
      .build();
    storeOverrides.gameState = gameStateFactory
      .withPlayers({ id: 0, library: [visibleTop.id] }, 1)
      .withObjects(visibleTop)
      .build();
    const view = renderGamePage();
    const pile = document.querySelector<HTMLButtonElement>(
      '[data-library-pile="0"] > button',
    );
    expect(pile).toBeEnabled();
    fireEvent.click(pile!);
    const dialog = await screen.findByRole("dialog", { name: /Library/ });
    await waitFor(() => expect(dialog).toHaveFocus());

    const hiddenTop = { ...visibleTop, display_visible_to_viewer: false };
    storeOverrides.gameState = gameStateFactory
      .withPlayers({ id: 0, library: [hiddenTop.id] }, 1)
      .withObjects(hiddenTop)
      .build();
    view.rerender(gamePageTree());
    expect(pile).toBeInTheDocument();
    expect(pile).toBeDisabled();

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Game menu" })).toHaveFocus();
  });

  it("closes the higher debug panel before opening its library viewer", async () => {
    renderGamePage();
    act(() => useUiStore.getState().openSandboxTools());
    expect(useUiStore.getState().debugPanelOpen).toBe(true);
    expect(useUiStore.getState().debugPanelTab).toBe("actions");
    expect(await screen.findByText("Debug Panel")).toBeInTheDocument();
    expect(await screen.findByText("Debug Actions")).toBeInTheDocument();
    const accordionToggle = await screen.findByRole("button", {
      name: /Browse Library/,
    });
    fireEvent.click(accordionToggle);
    const browseButtons = screen.getAllByRole("button", {
      name: /Browse Library/,
    });
    fireEvent.click(browseButtons[browseButtons.length - 1]);

    expect(screen.queryByText("Debug Panel")).not.toBeInTheDocument();

    await closeDialogAndExpectGameMenuFocus(await screen.findByRole("dialog"));
  });
});

/**
 * A refused takeback must not destroy a desktop-solo session.
 *
 * Desktop solo-vs-AI is served by the `phase-server` sidecar over a
 * WebSocket and arrives here as `mode=ai`, so `isOnlineMode` is false and
 * `case "error"` sets a TERMINAL `reconnectState`. The server used to answer
 * every refused takeback with `ServerMessage::error`, so a second takeback
 * click — reachable because an approved takeback clears the history — tore
 * down the adapter and stranded the game behind a "Connection lost" banner.
 * The refusal now travels `ServerMessage::ActionRejected`, which the adapter
 * surfaces as `requestRejected`.
 */

/**
 * GamePage is the authority on where Click Mode is offered: one
 * `sandboxToolsAvailable` decision feeds both the K hotkey and the Game-menu
 * toggle. The hook and the menu are tested below that seam with the flag or
 * handler passed in directly, so these cases pin the decision itself through
 * the real `useKeyboardShortcuts` listener GamePage mounts.
 */
describe("GamePage — Click Mode is offered only where sandbox tools are", () => {
  beforeEach(() => {
    useUiStore.setState({ debugInteractionMode: false, helpSheetOpen: false });
  });
  afterEach(() => {
    useUiStore.setState({ debugInteractionMode: false, helpSheetOpen: false });
  });

  it("offers the menu toggle and the K hotkey in a game against the AI", () => {
    renderGamePage("/game/test-game-123?mode=ai");

    expect(capturedGameMenuProps?.onToggleDebugInteractionMode).toBeTypeOf("function");

    fireEvent.keyDown(window, { key: "k" });

    expect(useUiStore.getState().debugInteractionMode).toBe(true);
  });

});

/**
 * A rematch starts a NEW game id from the game-over screen. The URL it carries
 * over names the format but holds none of its edited knobs, and the saved
 * active-game record is keyed to the id being left — so the config has to be
 * handed over explicitly or a custom starting life silently reverts to the
 * format default.
 */
describe("GamePage — rematch preserves the format the game was played with", () => {
  // The rematch button is gated on `onAnimationComplete` of the game-over
  // title's spring, which never settles under happy-dom's rAF. `skipAnimations`
  // is framer-motion's own switch for exactly this — animations jump to their
  // end state and fire their completion callbacks — so the gate is satisfied
  // the way the library intends rather than by mocking `motion` away. Scoped
  // to this block so the suite's other renders keep real motion behaviour.
  beforeEach(() => {
    MotionGlobalConfig.skipAnimations = true;
  });
  afterEach(() => {
    MotionGlobalConfig.skipAnimations = false;
  });

  it("hands the engine's own format config to the new game", async () => {
    const user = userEvent.setup();
    // A Commander game played at 25 life rather than the format's 40.
    storeOverrides.gameState = gameStateFactory.withPlayers(0, 1).build({
      format_config: buildCommanderFormatConfig({ starting_life: 25 }),
    });
    storeOverrides.waitingFor = { type: "GameOver", data: { winner: 0 } };

    renderGamePage("/game/old-game-id?mode=ai&format=Commander");

    await user.click(await screen.findByRole("button", { name: "Rematch" }));

    // Asserted at the engine boundary: this is the config GameProvider would
    // build the rematch with, not merely what was stashed on the navigation.
    // A lost hand-over would surface as the format default (40).
    expect(capturedFormatConfig?.starting_life).toBe(25);
  });

});
