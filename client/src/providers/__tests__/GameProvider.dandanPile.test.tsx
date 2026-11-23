import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComboDeclaration, CommanderBracketTier } from "../../types/bracketEstimate";

type Deck = {
  main_deck: string[];
  bracket_tier?: CommanderBracketTier | null;
  combo_declaration?: ComboDeclaration;
};
type DeckList = { player: Deck; opponent: Deck; ai_decks: Deck[] };

const {
  deckSupplyForFormat,
  gameStoreState,
  useGameStore,
} = vi.hoisted(() => {
  const gameStoreState = {
    adapter: null as unknown,
    gameId: null as string | null,
    gameState: null,
    initGame: vi.fn(async (..._args: unknown[]) => {}),
    resumeGame: vi.fn(),
    reset: vi.fn(),
    setGameMode: vi.fn(),
  };
  const useGameStore = Object.assign(
    vi.fn((selector: (state: typeof gameStoreState) => unknown) => selector(gameStoreState)),
    {
      getState: () => gameStoreState,
      setState: (partial: Record<string, unknown>) => Object.assign(gameStoreState, partial),
      subscribe: vi.fn(() => () => {}),
    },
  );
  return {
    deckSupplyForFormat: vi.fn(async (format: string) =>
      format === "Dandan" ? "HostPile" : format === "Momir" ? "EngineFixed" : "PlayerBuilt"),
    gameStoreState,
    useGameStore,
  };
});

vi.mock("../../services/engineRuntime", () => ({ deckSupplyForFormat }));


vi.mock("../../adapter/wasm-adapter", () => ({
  WasmAdapter: class {},
  getSharedAdapter: () => ({ cardDbLoaded: true }),
}));





vi.mock("../../stores/gameStore", () => ({
  clearActiveGame: vi.fn(),
  clearGame: vi.fn(),
  loadActiveGame: vi.fn(() => null),
  loadGame: vi.fn(async () => null),
  nextGameSessionGeneration: vi.fn(() => 1),
  saveActiveGame: vi.fn(),
  useGameStore,
}));

vi.mock("../../services/aiDeckCatalog", () => ({ buildLegalAiDeckCatalog: vi.fn(async () => ({ candidates: [] })) }));
vi.mock("../../stores/preferencesStore", () => ({
  AI_DECK_RANDOM: "Random",
  usePreferencesStore: Object.assign(vi.fn(), {
    getState: () => ({ aiSeats: [], cedhMode: false, artChain: [], artOverrides: {} }),
  }),
}));
vi.mock("../../services/cedhLock", () => ({ effectiveAiDifficulty: (difficulty: string) => difficulty }));
vi.mock("../../game/controllers/gameLoopController", () => ({
  createGameLoopController: vi.fn(() => ({ start: vi.fn(), dispose: vi.fn(), stop: vi.fn() })),
}));
vi.mock("../../game/dispatch", () => ({ dispatchAction: vi.fn(), processRemoteUpdate: vi.fn() }));
vi.mock("../../game/sessionCleanup", () => ({ clearPromptOverlayState: vi.fn() }));
vi.mock("../../hooks/useGameplayPreferencesSync", () => ({ useGameplayPreferencesSync: vi.fn() }));
vi.mock("../../audio/AudioManager", () => ({ audioManager: { setContext: vi.fn() } }));
vi.mock("../../stores/multiplayerStore", () => ({
  useMultiplayerStore: Object.assign(vi.fn(), { getState: () => ({}), setState: vi.fn() }),
}));
vi.mock("../../services/playerAvatars", () => ({
  assignRandomAvatars: vi.fn(() => []),
  avatarCardNameForName: vi.fn(),
  fetchAvatarArtUrl: vi.fn(async () => null),
}));
vi.mock("../../pwa/updateMarker", () => ({ consumeRecentAutoUpdateMarker: vi.fn() }));
vi.mock("../../services/quickDraftPersistence", () => ({
  loadDraftRun: vi.fn(),
  inspectActiveQuickDraftLifecycle: vi.fn(),
}));

import { ACTIVE_DECK_KEY, STORAGE_KEY_PREFIX } from "../../constants/storage";
import { formatMetadata } from "../../data/formatRegistry";
import type { GameFormat } from "../../adapter/types";
import { GameProvider } from "../GameProvider";

const PILE = Array<string>(80).fill("Island");
const NOT_LOADED = "Could not load deck. Try re-importing it.";

function config(format: GameFormat) {
  return formatMetadata(format)!.default_config;
}

function renderRoute(props: Partial<Parameters<typeof GameProvider>[0]> & { mode: Parameters<typeof GameProvider>[0]["mode"] }) {
  const onNoDeck = vi.fn();
  render(
    <GameProvider gameId="g1" onNoDeck={onNoDeck} {...props}>
      <div />
    </GameProvider>,
  );
  return onNoDeck;
}

async function localAiDeckList(): Promise<DeckList> {
  await waitFor(() => expect(gameStoreState.initGame).toHaveBeenCalled());
  return gameStoreState.initGame.mock.calls[0][2] as DeckList;
}

describe("GameProvider host-supplied pile routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    gameStoreState.adapter = null;
    gameStoreState.gameId = null;
    localStorage.setItem(`${STORAGE_KEY_PREFIX}Pile A`, JSON.stringify({ main: [{ name: "Island", count: 80 }], sideboard: [] }));
    localStorage.setItem(`${STORAGE_KEY_PREFIX}Active`, JSON.stringify({ main: [{ name: "Plains", count: 60 }], sideboard: [] }));
    localStorage.setItem(ACTIVE_DECK_KEY, "Active");
  });
  afterEach(cleanup);

  describe("supplied format", () => {
    it("local AI puts the named pile on the player seat and nothing elsewhere", async () => {
      renderRoute({ mode: "ai", formatConfig: config("Dandan"), pile: "Pile A" });
      const deckList = await localAiDeckList();
      expect(deckList.player.main_deck).toEqual(PILE);
      expect(deckList.opponent.main_deck).toEqual([]);
    });

    it("local AI submits empty for the default pile", async () => {
      renderRoute({ mode: "ai", formatConfig: config("Dandan") });
      expect((await localAiDeckList()).player.main_deck).toEqual([]);
    });

    it("local AI submits empty for an engine-fixed format with a named pile", async () => {
      renderRoute({ mode: "ai", formatConfig: config("Momir"), pile: "Pile A" });
      expect((await localAiDeckList()).player.main_deck).toEqual([]);
    });

    it("a vanished named pile reports the deck could not load", async () => {
      const onNoDeck = renderRoute({ mode: "ai", formatConfig: config("Dandan"), pile: "Gone" });
      await waitFor(() => expect(onNoDeck).toHaveBeenCalledWith(NOT_LOADED));
      expect(gameStoreState.initGame).not.toHaveBeenCalled();
    });

  });

});
