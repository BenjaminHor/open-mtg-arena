import { createContext, useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import {
  type FormatConfig,
  type GameAction,
  type MatchConfig,
  type MatchType,
  type TokenImageRef,
  persistedGameStateView,
} from "../adapter/types";
import { AdapterError, AdapterErrorCode } from "../adapter/types";
import { WasmAdapter, getSharedAdapter } from "../adapter/wasm-adapter";
import { audioManager } from "../audio/AudioManager";
import {
  ACTIVE_DECK_KEY,
  isRandomDeckSelection,
  loadActiveDeck,
  loadActiveDeckBracket,
  loadActiveDeckComboDeclaration,
} from "../constants/storage";
import type { ComboDeclaration, CommanderBracket } from "../types/bracket";
import { bracketToEngineTier, type CommanderBracketTier } from "../types/bracketEstimate";
import {
  buildLegalAiDeckCatalog,
  candidateDeclarations,
  candidateSeatDeck,
  type SeatDeclarations,
} from "../services/aiDeckCatalog";
import { pickRandomDeckCandidate } from "../services/randomDeckSelection";
import { withCatalogSavedNames } from "../services/randomPoolSelection";
import { cedhSeatProblem, pickAiSeatDecks, resolveRandomDrawPool } from "../services/aiRandomPool";
import { resolveLocalAiSeatPlan, type LocalAiSeatPlan } from "../services/localAiSeatPlan";
import { usePreferencesStore } from "../stores/preferencesStore";
import { CEDH_DIFFICULTY, effectiveAiDifficulty } from "../services/cedhLock";
import { createGameLoopController } from "../game/controllers/gameLoopController";
import { dispatchAction } from "../game/dispatch";
import { clearPromptOverlayState } from "../game/sessionCleanup";
import { useGameplayPreferencesSync } from "../hooks/useGameplayPreferencesSync";
import { expandParsedDeck, type ExpandedDeck, type ParsedDeck } from "../services/deckParser";
import {
  captureSubmissionArtPreferences,
  submitDeckList,
  submitParsedDeck,
  type SubmittedDeck,
  type SubmissionDeck,
} from "../services/deckSubmission";
import { formatSuppliesDeck } from "../data/formatRegistry";
import { emptySeatDeck, pileSeatDeck, pileSourceFromParam, type PileSource } from "../services/pileSource";
import { consumeRecentAutoUpdateMarker } from "../pwa/updateMarker";
import { inspectActiveQuickDraftLifecycle, loadDraftRun } from "../services/quickDraftPersistence";
import { loadGameStrict } from "../services/gamePersistence";
import type { DraftRunState } from "../services/quickDraftPersistence";
import { draftSessionFormatConfig } from "../services/draftFormatConfig";
import {
  clearGame,
  loadActiveGame,
  loadGame,
  nextGameSessionGeneration,
  useGameStore,
} from "../stores/gameStore";
import type { AISeatBinding } from "../game/controllers/aiController";
import { useMultiplayerStore } from "../stores/multiplayerStore";
import { isCoherentUnresolvedDraftStage } from "../stores/draftStore";
import {
  TURTLE_TEAMUP_SURVIVOR_IDENTITIES,
  assignRandomAvatars,
  fetchBossAvatarUrl,
} from "../services/playerAvatars";
import type { PlayerAvatarIdentity } from "../services/playerAvatars";
import { getSeatCount } from "../viewmodel/seatCount";

/** Build per-seat AI controller bindings for a game about to start. Reads
 *  the session-scoped `aiSeats` snapshot from `ActiveGameMeta` (written at
 *  game start by the setup page); falls back to a flat `difficulty` applied
 *  to every seat when no snapshot exists (e.g. resuming a pre-multi-AI save). */
function resolveAiSeatBindings(
  gameId: string,
  playerCount: number | undefined,
  fallbackDifficulty: string | undefined,
): AISeatBinding[] | undefined {
  const count = playerCount ?? 2;
  const opponentCount = Math.max(0, count - 1);
  if (opponentCount === 0) return undefined;
  const meta = loadActiveGame();
  const snapshot = meta?.id === gameId ? meta.aiSeats : undefined;
  const fallback = fallbackDifficulty ?? "Medium";
  return Array.from({ length: opponentCount }, (_, i) => ({
    playerId: i + 1,
    difficulty: snapshot?.[i]?.difficulty ?? fallback,
  }));
}

export function isDeckRejectedError(error: unknown): error is AdapterError {
  return error instanceof AdapterError && error.code === AdapterErrorCode.DECK_REJECTED;
}

function setupRandomAvatars(playerCount: number, seed: string) {
  const avatars = assignRandomAvatars(playerCount, seed);
  const names = new Map<number, string>();
  const playerAvatars = new Map<number, PlayerAvatarIdentity>();
  names.set(0, "You");
  for (const [playerId, avatar] of avatars.entries()) {
    if (playerId > 0) names.set(playerId, avatar.name);
    playerAvatars.set(playerId, { kind: "card", cardName: avatar.cardName });
  }
  useMultiplayerStore.setState({ playerNames: names, playerAvatars });
}

/**
 * Install one commander-derived identity per owner, and report whether it did.
 *
 * Derived from EVERY `is_commander` object in the state — deliberately NOT from
 * `command_zone`, which is only the cards sitting in the command zone at this
 * instant (`viewmodel/commanderColumn.ts` reads it that way). A commander that
 * has been cast, that died, or that was exiled is still its owner's commander
 * (CR 903.3), but it no longer appears in `command_zone` — so gating on that
 * list made a mid-game reload skip this derivation entirely and keep the random
 * planeswalker identities `setupRandomAvatars` seeded, swapping every seat's
 * name and avatar on refresh (issue #8053).
 *
 * A state with no commander object at all — a non-Commander game, or a snapshot
 * that has not loaded yet — writes NOTHING and answers `false`, so a caller's
 * existing fallback identities survive instead of being erased to empty maps.
 */
function setupCommanderAvatars(
  gameState: { objects: Record<number, { name: string; owner: number; is_commander?: boolean }> },
): boolean {
  const names = new Map<number, string>();
  const commanderNames = new Map<number, string>();
  const playerAvatars = new Map<number, PlayerAvatarIdentity>();

  for (const obj of Object.values(gameState.objects)) {
    if (!obj?.is_commander) continue;
    if (commanderNames.has(obj.owner)) continue;
    commanderNames.set(obj.owner, obj.name);
  }

  if (commanderNames.size === 0) return false;

  for (const [playerId, cardName] of commanderNames) {
    names.set(playerId, cardName.split(",")[0].split(" //")[0]);
    playerAvatars.set(playerId, { kind: "card", cardName });
  }

  useMultiplayerStore.setState({ playerNames: names, playerAvatars });
  return true;
}

/**
 * Install Turtle Team-Up Horde seat identities, and report whether it did.
 *
 * Horde seats have no commander (boss-deck games are Constructed), so without
 * this the random fallback `setupRandomAvatars` seeds names the TMNT villains
 * after arbitrary planeswalkers ("Vivien") and gives survivors arbitrary
 * avatar art ("Karn"). Horde seats take the deployed Boss's short name and
 * pinned art instead; survivors take the Turtle roster in seat order.
 *
 * Seat and Boss SELECTION is the engine's (`derived.horde`, built from the
 * game-state authorities): this renders that projection and only formats it —
 * short names, Turtle theming, image lookup. It never scans `command_zone`
 * for a Boss and never classifies seats from the raw seat vector, so a
 * snapshot omitting that vector still resolves. The projection lists deployed
 * Bosses only — never the face-down Boss pile — so hidden Bosses cannot leak
 * through the seat identity. The Turtle-Team-Up gate below is presentation
 * theming (which avatar roster), not game-state derivation: other challenge
 * decks keep the existing random/commander identities.
 *
 * Like `setupCommanderAvatars`, writes NOTHING and answers `false` when this
 * isn't a Turtle Team-Up game or no Boss is deployed yet, so the caller's
 * fallback identities survive and the subscription keeps listening.
 */
function setupHordeAvatars(
  gameState: {
    format_config?: { format?: string; horde_ruleset?: { challenge_deck?: string } | null } | null;
    derived?: {
      horde?: {
        horde_seat_ids?: readonly number[];
        hero_player_ids?: readonly number[];
        deployed_boss_ids?: readonly number[];
      } | null;
    };
    objects: Record<number, { name: string; token_image_ref?: TokenImageRef | null }>;
  },
  gameId: string,
): boolean {
  if (gameState.format_config?.format !== "Horde") return false;
  if (gameState.format_config?.horde_ruleset?.challenge_deck !== "TurtleTeamUpHorde") {
    return false;
  }
  const horde = gameState.derived?.horde;
  const bossId = horde?.deployed_boss_ids?.[0];
  const boss = bossId != null ? gameState.objects[bossId] : undefined;
  if (!horde || bossId == null || !boss) return false;
  const hordeSeats = horde.horde_seat_ids ?? [];
  const names = new Map<number, string>();
  const playerAvatars = new Map<number, PlayerAvatarIdentity>();
  const bossShortName = boss.name.split(",")[0].split(" //")[0];
  for (const seatId of hordeSeats) {
    names.set(seatId, bossShortName);
  }
  (horde.hero_player_ids ?? []).forEach((seatId, survivorIndex) => {
    const turtle = TURTLE_TEAMUP_SURVIVOR_IDENTITIES[
      survivorIndex % TURTLE_TEAMUP_SURVIVOR_IDENTITIES.length
    ];
    names.set(seatId, turtle.name);
    playerAvatars.set(seatId, { kind: "card", cardName: turtle.cardName });
  });
  useMultiplayerStore.setState({ playerNames: names, playerAvatars });
  // Boss art resolves async through the token-image sidecar, so names never
  // wait on it. Merged into the stored map when it lands, bound to the game
  // id, the session generation, and the requested Boss: a debug import
  // replaces the session under the same route id (bumping only the
  // generation), and a stage clear replaces the Boss under the same session,
  // so an id-only fence would paint a stale portrait either way. A sidecar
  // miss leaves the seat without an avatar entry and the HUD renders the
  // initial tile.
  const bossRef = boss.token_image_ref;
  if (bossRef?.scryfall_id) {
    const generation = useGameStore.getState().gameSessionGeneration;
    void fetchBossAvatarUrl(bossRef).then((url) => {
      const current = useGameStore.getState();
      if (!url || current.gameId !== gameId) return;
      if (current.gameSessionGeneration !== generation) return;
      if (current.gameState?.derived?.horde?.deployed_boss_ids?.[0] !== bossId) return;
      const next = new Map(useMultiplayerStore.getState().playerAvatars);
      for (const seatId of hordeSeats) {
        next.set(seatId, { kind: "external", url });
      }
      useMultiplayerStore.setState({ playerAvatars: next });
    });
  }
  return true;
}

type ExpandedDeckWithTier = SubmittedDeck<ExpandedDeck> & {
  /** The owner's declared bracket; `null` is undeclared (the engine plays the estimate). */
  bracket_tier: CommanderBracketTier | null;
  /** The deck owner's two-card-combo answer; omitted means unanswered (the engine's default). */
  combo_declaration?: ComboDeclaration;
};
type DeckListPayload = {
  player: ExpandedDeckWithTier;
  opponent: ExpandedDeckWithTier;
  ai_decks: ExpandedDeckWithTier[];
  /** AI difficulty strings per seat (opponent first, then extra AI decks).
   *  Passed through to the engine's `DeckList.ai_difficulties` field so the
   *  WASM bridge can gate cEDH bracket validation on AI difficulty rather than
   *  deck bracket tier. */
  ai_difficulties: string[];
};

function hasExactKeys(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

function sameStringArray(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length
    && value.every((entry, index) => typeof entry === "string" && entry === expected[index]);
}

/** Validate the name-only publication before decorating a separate in-memory submission. */
function matchesPublishedDraftPayload(value: unknown, run: DraftRunState): boolean {
  if (!hasExactKeys(value, ["player", "opponent", "ai_decks"], ["booster_pack_pool"])) return false;
  const matchesDeck = (deck: unknown, mainDeck: string[], companion: readonly string[] = []) =>
    hasExactKeys(deck, ["main_deck", "sideboard", "commander"], ["companion"])
    && sameStringArray(deck.main_deck, mainDeck)
    && sameStringArray(deck.sideboard, [])
    && sameStringArray(deck.commander, [])
    // CR 702.139a: the designation is published (even when empty) for the seat
    // that drafted it; it must be exactly the stored run's, and an absent key
    // means no designation.
    && sameStringArray(deck.companion ?? [], companion);
  if (!matchesDeck(value.player, run.playerDeck, run.companion ? [run.companion] : [])
    || !matchesDeck(value.opponent, run.opponentDeck)
    || !Array.isArray(value.ai_decks) || value.ai_decks.length !== 0) return false;
  const pool = run.booster_pack_pool;
  if (pool === undefined) return !Object.prototype.hasOwnProperty.call(value, "booster_pack_pool");
  if (pool === null) return value.booster_pack_pool === null;
  return Array.isArray(pool) && sameStringArray(value.booster_pack_pool, pool);
}

/** One fresh handoff binds every locally configured seat without changing publication. */
async function submitLocalHandoff<T extends {
  player: SubmissionDeck;
  opponent: SubmissionDeck;
  ai_decks: SubmissionDeck[];
}>(payload: T) {
  const snapshot = captureSubmissionArtPreferences();
  const [player, opponent, ...ai_decks] = await Promise.all(
    [payload.player, payload.opponent, ...payload.ai_decks].map((deck) => submitDeckList(deck, snapshot)),
  );
  return { ...payload, player, opponent, ai_decks };
}

// The empty decklist a seat submits when it has no deck to send.
const EMPTY_PARSED_DECK: ParsedDeck = { main: [], sideboard: [] };

function emptySeat(): ExpandedDeckWithTier {
  return { ...emptySeatDeck(), bracket_tier: null };
}

// Exported for the Horde payload regression tests; production callers go
// through the GameProvider start flow.
export async function buildLocalAiDeckList(
  t: TFunction<["game", "multiplayer"]>,
  deck: ParsedDeck | null,
  playerCount: number,
  formatConfig: FormatConfig | undefined,
  selectedMatchType: MatchType | undefined,
  playerBracket: CommanderBracket | null,
  comboDeclaration: ComboDeclaration,
  pileSource: PileSource,
  seats: readonly LocalAiSeatPlan[],
): Promise<DeckListPayload> {
  // Supplied-deck formats have no AI deck catalog: the pile seat submits the
  // host's pile (empty for the default or an engine-fixed deck) and every other
  // seat submits nothing, leaving the engine to load the shared or fixed deck.
  if (formatConfig && formatSuppliesDeck(formatConfig.format)) {
    const opponentCount = Math.max(1, playerCount - 1);
    const pile = await pileSeatDeck(formatConfig.format, pileSource);
    if (!pile) throw new Error(t("multiplayer:page.couldNotLoadDeck"));
    const aiDifficulties = seats.map((seat) => seat.difficulty);
    return {
      player: { ...pile, bracket_tier: null },
      opponent: emptySeat(),
      ai_decks: Array.from({ length: opponentCount - 1 }, emptySeat),
      ai_difficulties: aiDifficulties,
    };
  }

  // Horde: the human is a survivor bringing their own constructed deck; the
  // Horde seats are the self-piloting Horde, whose libraries are the
  // engine-supplied challenge decks injected by `load_horde_library`. No saved
  // deck is tagged "Horde", so Horde seats submit empty and must NOT be drawn
  // from the (empty) Horde-filtered catalog — but AI seats OUTSIDE the Horde
  // roster are allied survivors and need real decks from the unfiltered
  // catalog, or they start with an empty library and lose on their first draw.
  if (formatConfig && formatConfig.format === "Horde") {
    const { aiSeats, cedhMode } = usePreferencesStore.getState();
    const opponentCount = Math.max(1, playerCount - 1);
    const emptySeat = (): ExpandedDeckWithTier => ({
      main_deck: [],
      sideboard: [],
      commander: [],
      planar_deck: [],
      scheme_deck: [],
      signature_spell: [],
      companion: [],
      sticker_sheets: [],
      bracket_tier: null,
    });
    // One catalog fetch serves the human Random fallback AND the AI survivor
    // seats: no format tag (the pool is unrestricted), but the picked
    // challenge deck, so the engine validates each candidate against the
    // challenge's survivor requirements (Commander shape for EDH hordes,
    // unrestricted for constructed-block hordes).
    const survivorCatalog = await buildLegalAiDeckCatalog({
      selectedMatchType,
      selectedChallengeDeck: formatConfig.horde_ruleset?.challenge_deck ?? null,
    });
    let hordePlayerDeck = deck;
    let hordePlayerDeclarations: SeatDeclarations = {
      bracket_tier: bracketToEngineTier(playerBracket),
      combo_declaration: comboDeclaration,
    };
    if (!hordePlayerDeck) {
      // Human chose "Random Deck": pick from the unfiltered catalog rather
      // than the Horde-tagged one (which is empty).
      const pick = pickRandomDeckCandidate(survivorCatalog.candidates, {});
      if (!pick) {
        throw new Error(t("gameProvider.noLegalAiDecks.generic"));
      }
      hordePlayerDeck = pick.deck;
      hordePlayerDeclarations = candidateDeclarations(pick);
    }
    // Seat map: player = seat 0 (human survivor), opponent = seat 1 (Horde
    // primary — the init path remaps archenemy_player onto the first AI seat),
    // ai_decks[i] = seat 2+i. The Horde roster is the primary plus one seat
    // per co-Horde deck; roster seats submit empty (the engine injects
    // challenge libraries), every other AI seat is an allied survivor.
    const hordeSeatCount =
      1 + (formatConfig.horde_ruleset?.co_horde_decks?.length ?? 0);
    const takenDeckIds = new Set<string>();
    const aiDecks: ExpandedDeckWithTier[] = [];
    for (let i = 0; i < opponentCount - 1; i++) {
      if (i < hordeSeatCount - 1) {
        aiDecks.push(emptySeat());
        continue;
      }
      const pick = pickRandomDeckCandidate(survivorCatalog.candidates, {
        excludeIds: takenDeckIds,
      });
      if (!pick) {
        throw new Error(t("gameProvider.noLegalAiDecks.generic"));
      }
      takenDeckIds.add(pick.id);
      aiDecks.push(candidateSeatDeck(pick, expandParsedDeck(pick.deck)));
    }
    const aiDifficulties = Array.from({ length: opponentCount }, (_, i) =>
      effectiveAiDifficulty(aiSeats[i]?.difficulty ?? "Medium", cedhMode),
    );
    return {
      player: {
        ...expandParsedDeck(hordePlayerDeck),
        ...hordePlayerDeclarations,
      },
      opponent: emptySeat(),
      ai_decks: aiDecks,
      ai_difficulties: aiDifficulties,
    };
  }

  const {
    aiArchetypeFilter,
    aiCoverageFloor,
    aiBracketFilter,
    humanPoolSelection,
    aiPoolSelection,
  } = usePreferencesStore.getState();
  // The seat snapshot already maps table cEDH into each seat's difficulty, and
  // the engine's cEDH bracket gate fires per seat — so the table is cEDH
  // exactly when any seat plays at cEDH difficulty.
  const tableCedh = seats.some((seat) => seat.difficulty === CEDH_DIFFICULTY);
  const catalog = await buildLegalAiDeckCatalog({
    selectedFormat: formatConfig?.format,
    selectedMatchType,
  });
  if (catalog.candidates.length === 0) {
    throw new Error(
      formatConfig?.format
        ? t("gameProvider.noLegalAiDecks.withFormat", { format: formatConfig.format })
        : t("gameProvider.noLegalAiDecks.generic"),
    );
  }

  // The bracket/cEDH restriction is the same pool the setup page previews
  // (`restrictAiPoolByBracket`): Random seats draw from it, so a 1–3 filter
  // can never field a bracket-4+ deck. Pinned seats bypass the pool —
  // `pickAiSeatDecks` resolves explicit ids against the full catalog.
  const requestedDeckIds = seats.map((seat) => seat.deckId);
  // An empty pool means the table's bracket constraint excluded every legal
  // deck (the catalog itself is non-empty here). In cEDH mode the engine
  // rejects any non-bracket-5 deck at init (`validate_cedh_bracket`, gated
  // on CEDH AI difficulties), so there is no legal fallback: fail fast
  // unless every seat is pinned to an explicit deck. Otherwise (manual
  // filter) any legal deck plays fine — the setup page warns about the
  // empty pool (soft gate, Start stays enabled), so fall back to the full
  // legal catalog.
  // A pinned non-bracket-5 deck (`PinnedDeckNotCedh`) is left to the engine's own
  // cEDH bracket gate at init, which reports the specific bracket error.
  if (
    cedhSeatProblem({
      catalog: catalog.candidates,
      requestedDeckIds,
      bracketFilter: aiBracketFilter,
      cedhMode: tableCedh,
      selectedFormat: formatConfig?.format ?? null,
    }) === "NoCedhDeckForRandom"
  ) {
    throw new Error(
      formatConfig?.format
        ? t("gameProvider.noLegalAiDecks.withFormat", { format: formatConfig.format })
        : t("gameProvider.noLegalAiDecks.generic"),
    );
  }

  const excludeIds = new Set<string>();
  let playerDeck: ParsedDeck;
  let playerDeclarations: SeatDeclarations;
  if (deck) {
    playerDeck = deck;
    playerDeclarations = {
      bracket_tier: bracketToEngineTier(playerBracket),
      combo_declaration: comboDeclaration,
    };
  } else {
    // A deferred human Random pick draws from the shared bracket-then-curation
    // layering, so it lands in the same bracket(s) as the AI seats (falling
    // back the same way when the selection matches nothing).
    const playerPool = resolveRandomDrawPool(withCatalogSavedNames(catalog.candidates), {
      bracketFilter: aiBracketFilter,
      cedhMode: tableCedh,
      selectedFormat: formatConfig?.format,
      poolSelection: humanPoolSelection,
    }).pool;
    const playerPick = pickRandomDeckCandidate(playerPool, {
      selectedFormat: formatConfig?.format,
    });
    if (!playerPick) {
      throw new Error(
        formatConfig?.format
          ? t("gameProvider.noLegalAiDecks.withFormat", { format: formatConfig.format })
          : t("gameProvider.noLegalAiDecks.generic"),
      );
    }
    playerDeck = playerPick.deck;
    playerDeclarations = candidateDeclarations(playerPick);
    excludeIds.add(playerPick.id);
  }

  const picks = pickAiSeatDecks({
    catalog: catalog.candidates,
    requestedDeckIds,
    archetypeFilter: aiArchetypeFilter,
    coverageFloor: aiCoverageFloor,
    bracketFilter: aiBracketFilter,
    cedhMode: tableCedh,
    selectedFormat: formatConfig?.format,
    poolSelection: aiPoolSelection,
    excludeIds,
  });

  const snapshot = captureSubmissionArtPreferences();
  const [playerSubmitted, ...aiSubmitted] = await Promise.all(
    [playerDeck, ...picks.map((candidate) => candidate.deck)].map((candidate) => submitParsedDeck(candidate, snapshot)),
  );
  // Build ai_difficulties in the same order as the AI seats: opponent first,
  // then any additional ai_decks. Seat 0 maps to the opponent, seats 1+ map
  // to ai_decks. The plan's difficulties are already cEDH-mapped.
  const aiDifficulties = seats.map((seat) => seat.difficulty);
  return {
    player: { ...playerSubmitted, ...playerDeclarations },
    opponent: candidateSeatDeck(picks[0], aiSubmitted[0]),
    ai_decks: aiSubmitted.slice(1).map((submitted, index) => candidateSeatDeck(picks[index + 1], submitted)),
    ai_difficulties: aiDifficulties,
  };
}

const GameDispatchContext = createContext<(action: GameAction) => Promise<void>>(
  () => {
    throw new Error("No GameProvider found in component tree");
  },
);

// Deferred store reset: cleanup schedules the store clear on a macrotask so that
// an immediate remount (StrictMode double-mount, or any dep-change re-run) can
// cancel it before it fires. Without this, every cleanup briefly sets
// gameState to null and GameBoard flashes "Waiting for game..." before the
// next initGame/resumeGame repopulates the store.
let pendingStoreReset: ReturnType<typeof setTimeout> | null = null;

function cancelPendingStoreReset(): void {
  if (pendingStoreReset !== null) {
    clearTimeout(pendingStoreReset);
    pendingStoreReset = null;
  }
}

function scheduleStoreReset(reset: () => void): void {
  cancelPendingStoreReset();
  pendingStoreReset = setTimeout(() => {
    pendingStoreReset = null;
    reset();
  }, 0);
}

export interface GameProviderProps {
  gameId: string;
  mode: "ai" | "local";
  difficulty?: string;
  formatConfig?: FormatConfig;
  playerCount?: number;
  matchConfig?: MatchConfig;
  /** CR 103.1: 0 = human plays first, 1 = opponent plays first, undefined = random. */
  firstPlayer?: number;
  source?: string;
  draftId?: string;
  /** The saved-deck name the host picked as a `HostPile` format's pile; absent = the default pile. */
  pile?: string;
  onReady?: () => void;
  onCardDataMissing?: () => void;
  /** Called when the game cannot start. `bracketViolation` is `true` when the
   *  engine rejected init because one or more decks are not bracket 5 at a
   *  cEDH table — lets callers show a typed modal rather than matching by
   *  string substring on the error message. */
  onNoDeck?: (reason?: string, bracketViolation?: boolean) => void;
  /** Called when a saved game could not be resumed and a fresh game was started instead. */
  onResumeReset?: (reason: string) => void;
  children: ReactNode;
}

export function GameProvider({
  gameId,
  mode,
  difficulty,
  formatConfig,
  playerCount,
  matchConfig,
  firstPlayer,
  source,
  draftId,
  pile,
  onReady,
  onCardDataMissing,
  onNoDeck,
  onResumeReset,
  children,
}: GameProviderProps) {
  const { t } = useTranslation(["game", "common", "draft", "multiplayer"]);

  // Sync persistent gameplay preferences into engine-owned state so the
  // engine remains the single authority for priority recommendations.
  useGameplayPreferencesSync();

  // Refs for callback props — these are notifications that should never
  // cause the game setup effect to re-run.
  const onReadyRef = useRef(onReady);
  const onCardDataMissingRef = useRef(onCardDataMissing);
  const onNoDeckRef = useRef(onNoDeck);
  const onResumeResetRef = useRef(onResumeReset);
  // `t` is referenced inside the game-setup effect. Keep it in a ref (like the
  // callback props above) so the effect dep array stays free of it — a language
  // switch must not re-run the heavy initGame/resumeGame pipeline.
  const tRef = useRef(t);
  onReadyRef.current = onReady;
  onCardDataMissingRef.current = onCardDataMissing;
  onNoDeckRef.current = onNoDeck;
  onResumeResetRef.current = onResumeReset;
  tRef.current = t;

  useEffect(() => {
    // A prior cleanup may have deferred a store reset. Cancel it — this mount
    // is about to populate the store via initGame/resumeGame, and a fire from
    // the previous cleanup would null out the state we just wrote.
    cancelPendingStoreReset();
    // Issue #2369: convoke ManaPayment + pendingAbilityChoice must not survive
    // across sessions while initGame/resumeGame is still in flight — canceling
    // the deferred reset alone leaves stale overlays clickable until the engine
    // responds.
    clearPromptOverlayState();

    const { initGame, resumeGame, reset, setGameMode } = useGameStore.getState();
    setGameMode(mode);
    if (mode === "ai") {
      setupRandomAvatars(playerCount ?? 2, gameId);
    } else {
      useMultiplayerStore.setState({ playerNames: new Map(), playerAvatars: new Map() });
    }

    let controller: ReturnType<typeof createGameLoopController> | null = null;
    let cancelled = false;

    // AI or local mode — async setup (loadGame is async due to IndexedDB)
    //
    // Uses the shared singleton adapter so the WASM worker (and its V8 TurboFan-
    // optimized code, card database, and AI worker pool) persist across game sessions.
    // On cleanup, we clear the WASM game state but keep the worker alive.
    const setupLocal = async () => {
      if (cancelled) return;
      const adapter = getSharedAdapter();
      const soloDraft = source === "draft" && !!draftId;
      const draftDeckKey = `phase:draft-deck:${gameId}`;
      const reportDraftError = (error: unknown) => {
        if (!cancelled) onNoDeckRef.current?.(error instanceof Error ? error.message : String(error));
      };
      const unavailableDraftStage = () => new Error(tRef.current("draft:run.resumeUnavailable"));
      const loadExactDraftRun = async (): Promise<DraftRunState> => {
        const meta = await inspectActiveQuickDraftLifecycle("inspect");
        if (!meta || meta.id !== draftId) throw unavailableDraftStage();
        const run = await loadDraftRun(draftId!);
        if (!run) throw unavailableDraftStage();
        if (!isCoherentUnresolvedDraftStage(run, draftId!, gameId)
          || (meta.setCode === "custom-cube" && !Array.isArray(run.booster_pack_pool))) {
          throw unavailableDraftStage();
        }
        return run;
      };
      // CR 100.2b + CR 702.139b: the draft match runs under the session's own
      // minimum deck size, recorded on the run at launch.
      const draftMatchFormatConfig = (run: DraftRunState | null) =>
        formatConfig && run
          ? draftSessionFormatConfig(formatConfig, run.min_deck_size)
          : formatConfig;
      const startDraftDeck = async (raw: string) => {
        try {
          const deckList = JSON.parse(raw) as DeckListPayload;
          let run: DraftRunState | null = null;
          if (soloDraft) {
            run = await loadExactDraftRun();
            if (cancelled) return;
            if (!matchesPublishedDraftPayload(deckList, run)) throw unavailableDraftStage();
          }
          const submission = await submitLocalHandoff(deckList);
          if (cancelled) return;
          await initGame(
            gameId,
            adapter,
            submission,
            draftMatchFormatConfig(run),
            playerCount,
            matchConfig,
            firstPlayer,
            soloDraft ? "strict" : "best-effort",
          );
          if (cancelled) return;
          controller = createGameLoopController({
            mode: mode === "local" ? "local" : "ai", difficulty,
            aiSeats: resolveAiSeatBindings(gameId, playerCount, difficulty), playerCount,
          });
          controller.start();
          if (cancelled) return;
          audioManager.setContext("battlefield");
        } catch (error) {
          console.error("Draft deck validation failed:", error);
          reportDraftError(error);
          return;
        }
        try {
          if (sessionStorage.getItem(draftDeckKey) === raw) sessionStorage.removeItem(draftDeckKey);
        } catch (error) {
          // A playable game has started. Keep the handoff for a later cleanup
          // attempt when storage is unavailable instead of reporting a failed start.
          console.warn("Could not consume draft deck handoff:", error);
        }
      };
      const startExactDraftStage = async () => {
        try {
          const run = await loadExactDraftRun();
          if (cancelled) return;
          const deckList = {
            booster_pack_pool: run.booster_pack_pool,
            player: {
              main_deck: run.playerDeck,
              sideboard: [],
              commander: [],
              companion: run.companion ? [run.companion] : [],
            },
            opponent: { main_deck: run.opponentDeck, sideboard: [], commander: [] },
            ai_decks: [],
          };
          const submission = await submitLocalHandoff(deckList);
          if (cancelled) return;
          await initGame(
            gameId, adapter, submission, draftMatchFormatConfig(run), playerCount, matchConfig, firstPlayer, "strict",
          );
          if (cancelled) return;
          controller = createGameLoopController({
            mode: mode === "local" ? "local" : "ai", difficulty,
            aiSeats: resolveAiSeatBindings(gameId, playerCount, difficulty), playerCount,
          });
          controller.start();
          if (!cancelled) audioManager.setContext("battlefield");
        } catch (error) {
          console.error("Draft IDB deck fallback failed:", error);
          reportDraftError(error);
        }
      };
      let draftDeckRaw: string | null = null;
      let savedState;
      try {
        savedState = await (soloDraft ? loadGameStrict(gameId) : loadGame(gameId));
      } catch (error) {
        if (cancelled) return;
        reportDraftError(error);
        return;
      }
      if (cancelled) return;

      // Horde: the archenemy (Horde) seat is an AI, never the local human (who
      // is always seat 0 in solo Play-vs-AI). Remap the registry default
      // (archenemy_player: 0) onto the first AI seat (seat 1) so
      // `load_horde_library` injects the challenge deck under the AI, not the
      // player — otherwise the human is dealt the Cyberman library (the
      // seat-inversion bug). Mirrors the P2PHostAdapter remap on the host path.
      const initFormatConfig =
        formatConfig?.format === "Horde"
          ? { ...formatConfig, archenemy_player: 1 }
          : formatConfig;
      if (soloDraft) {
        try {
          draftDeckRaw = sessionStorage.getItem(draftDeckKey);
        } catch (error) {
          if (!savedState) {
            reportDraftError(error);
            return;
          }
          console.warn("Could not read draft deck handoff during saved-game restore:", error);
        }
      }

      if (soloDraft) {
        if (!savedState) {
          if (draftDeckRaw !== null) await startDraftDeck(draftDeckRaw);
          else await startExactDraftStage();
          return;
        }
        try {
          await loadExactDraftRun();
          if (cancelled) return;
        } catch (error) {
          reportDraftError(error);
          return;
        }
        try {
          await resumeGame(gameId, adapter, savedState);
        } catch (error) {
          if (cancelled) return;
          console.warn("Failed to resume saved draft game:", error);
          reportDraftError(error);
          return;
        }
        if (cancelled) return;
        try {
          const resumedPlayerCount = persistedGameStateView(savedState).players.length;
          controller = createGameLoopController({
            mode: mode === "local" ? "local" : "ai", difficulty,
            aiSeats: resolveAiSeatBindings(gameId, resumedPlayerCount, difficulty),
            playerCount: resumedPlayerCount,
          });
          controller.start();
          if (cancelled) return;
          audioManager.setContext("battlefield");
        } catch (error) {
          reportDraftError(error);
          return;
        }
        if (draftDeckRaw !== null) {
          try {
            if (sessionStorage.getItem(draftDeckKey) === draftDeckRaw) sessionStorage.removeItem(draftDeckKey);
          } catch (error) {
            console.warn("Could not consume draft deck handoff:", error);
          }
        }
        return;
      }

      if (savedState) {
        try {
          // WasmAdapter.restoreState() loads the card DB into its shared worker
          // before rehydrating. Do not also initialize the main-thread runtime:
          // that duplicates both the WASM module and full card corpus, which can
          // exceed the WebContent memory budget on iOS.
          await resumeGame(gameId, adapter, savedState);
          if (cancelled) return;
          // Derive player count from the restored state — the URL param may be
          // absent on resume (e.g. navigating directly to a saved game URL).
          const resumedPlayerCount = persistedGameStateView(savedState).players.length;
          controller = createGameLoopController({
            mode: mode === "local" ? "local" : "ai",
            difficulty,
            aiSeats: resolveAiSeatBindings(gameId, resumedPlayerCount, difficulty),
            playerCount: resumedPlayerCount,
          });
          controller.start();
          audioManager.setContext("battlefield");
        } catch (err) {
          // Saved state is incompatible (e.g. engine type changes) — clear it
          // and fall through to start a fresh game.
          if (cancelled) return;
          console.warn("Failed to resume saved game, starting fresh:", err);
          const wasAutoUpdate = consumeRecentAutoUpdateMarker();
          const reason = wasAutoUpdate
            ? tRef.current("gameProvider.resumeReset.appUpdated")
            : tRef.current("gameProvider.resumeReset.restoreFailed", {
                error: err instanceof Error ? err.message : String(err),
              });
          onResumeResetRef.current?.(reason);
          clearGame(gameId);
          const activeDeckName = localStorage.getItem(ACTIVE_DECK_KEY);
          const randomPlayerDeck = isRandomDeckSelection(activeDeckName);
          const parsedDeck = randomPlayerDeck ? null : loadActiveDeck();
          const suppliesDeck = formatConfig ? formatSuppliesDeck(formatConfig.format) : false;
          if (!parsedDeck && !suppliesDeck && !randomPlayerDeck) {
            onNoDeckRef.current?.();
            return;
          }
          let deckList: DeckListPayload;
          try {
            deckList = await buildLocalAiDeckList(
              tRef.current,
              randomPlayerDeck ? null : (parsedDeck ?? EMPTY_PARSED_DECK),
              playerCount ?? 2,
              formatConfig,
              matchConfig?.match_type,
              loadActiveDeckBracket(),
              loadActiveDeckComboDeclaration(),
              pileSourceFromParam(pile),
              resolveLocalAiSeatPlan(gameId, playerCount ?? 2),
            );
          } catch (deckErr) {
            onNoDeckRef.current?.(deckErr instanceof Error ? deckErr.message : String(deckErr));
            return;
          }
          if (cancelled) return;
          try {
            await initGame(gameId, adapter, deckList, initFormatConfig, playerCount, matchConfig, firstPlayer);
            if (cancelled) return;
            if (!adapter.cardDbLoaded) {
              onCardDataMissingRef.current?.();
            }
            controller = createGameLoopController({
              mode: mode === "local" ? "local" : "ai",
              difficulty,
              aiSeats: resolveAiSeatBindings(gameId, playerCount, difficulty),
              playerCount,
            });
            controller.start();
            audioManager.setContext("battlefield");
          } catch (initErr) {
            console.error("Deck validation failed:", initErr);
            if (!cancelled) {
              const isBracketViolation =
                initErr instanceof AdapterError &&
                initErr.code === AdapterErrorCode.BRACKET_VIOLATION;
              onNoDeckRef.current?.(
                initErr instanceof Error ? initErr.message : String(initErr),
                isBracketViolation,
              );
            }
          }
        }
        return;
      }

      // No saved state — start a new game.
      // Quick drafts and local Commander pods publish their full engine payload
      // in sessionStorage, including opaque original cube metadata.
      if (!soloDraft) {
        try {
          draftDeckRaw = sessionStorage.getItem(draftDeckKey);
        } catch (error) {
          reportDraftError(error);
          return;
        }
      }
      if (draftDeckRaw !== null) {
        await startDraftDeck(draftDeckRaw);
        return;
      }

      const activeDeckName = localStorage.getItem(ACTIVE_DECK_KEY);
      const randomPlayerDeck = isRandomDeckSelection(activeDeckName);
      const parsedDeck = randomPlayerDeck ? null : loadActiveDeck();
      const suppliesDeck = formatConfig ? formatSuppliesDeck(formatConfig.format) : false;
      if (!parsedDeck && !suppliesDeck && !randomPlayerDeck) {
        onNoDeckRef.current?.();
        return;
      }

      let deckList: DeckListPayload;
      try {
        deckList = await buildLocalAiDeckList(
          tRef.current,
          randomPlayerDeck ? null : (parsedDeck ?? EMPTY_PARSED_DECK),
          playerCount ?? 2,
          formatConfig,
          matchConfig?.match_type,
          loadActiveDeckBracket(),
          loadActiveDeckComboDeclaration(),
          pileSourceFromParam(pile),
          resolveLocalAiSeatPlan(gameId, playerCount ?? 2),
        );
      } catch (deckErr) {
        onNoDeckRef.current?.(deckErr instanceof Error ? deckErr.message : String(deckErr));
        return;
      }
      if (cancelled) return;
      try {
        await initGame(
          gameId,
          adapter,
          deckList,
          initFormatConfig,
          playerCount,
          matchConfig,
          firstPlayer,
        );
        if (cancelled) return;
        if (!adapter.cardDbLoaded) {
          onCardDataMissingRef.current?.();
        }
        controller = createGameLoopController({
          mode: mode === "local" ? "local" : "ai",
          difficulty,
          aiSeats: resolveAiSeatBindings(gameId, playerCount, difficulty),
          playerCount,
        });
        controller.start();
        audioManager.setContext("battlefield");
      } catch (err) {
        console.error("Deck validation failed:", err);
        if (!cancelled) {
          const isBracketViolation =
            err instanceof AdapterError &&
            err.code === AdapterErrorCode.BRACKET_VIOLATION;
          onNoDeckRef.current?.(
            err instanceof Error ? err.message : String(err),
            isBracketViolation,
          );
        }
      }
    };

    const resetLocalStore = () => {
      // Clear store state but keep the shared WASM worker alive — its V8
      // TurboFan-compiled code, card database, and AI pool persist for reuse.
      const adapter = useGameStore.getState().adapter;
      if (adapter instanceof WasmAdapter) {
        // Not awaited (cleanup can't be async), but safe: resetGame is posted
        // to the same worker's FIFO message queue, so it executes before any
        // subsequent initializeGame call from the next game session.
        adapter.resetGameState();
        // Defer the store clear so a StrictMode remount or dep-change re-run
        // can cancel it before it fires. On real unmount (user navigates
        // away), the timeout fires on the next macrotask and clears the store.
        scheduleStoreReset(() => {
          useGameStore.setState({
            gameId: null,
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
            stateHistory: [],
            turnCheckpoints: [],
          });
        });
      } else {
        scheduleStoreReset(reset);
      }
    };

    void setupLocal();

    return () => {
      cancelled = true;
      if (controller) controller.dispose();
      audioManager.setContext("menu");
      // Issue #2369: drop prompt overlays synchronously so the next mount's
      // `cancelPendingStoreReset` cannot resurrect convoke payment UI.
      clearPromptOverlayState();
      resetLocalStore();
    };
  }, [gameId, mode, difficulty, formatConfig, playerCount, matchConfig, firstPlayer, source, draftId, pile]);

  // Seat identities derive AFTER the setup effect above: setup re-seeds the
  // random fallback on every mount, so a derivation placed before it would
  // lose on a remount with loaded state (and the Horde continuity key would
  // then suppress every later snapshot as "unchanged"). Deriving last, the
  // mount run wins over the seed and continuous play and a remount agree.
  useEffect(() => {
    if (mode !== "ai") return;
    // Horde games with themed seats take Horde identities; everything else
    // falls through to the commander derivation. The commander branch is
    // one-shot per session — it applies as soon as the state carries a
    // commander, in whatever zone it is in (see `setupCommanderAvatars`
    // for why the command zone is the wrong gate). The Horde branch is
    // continuous: a stage clear replaces the deployed Boss under the same
    // session, so the seat must re-derive whenever the engine's projected
    // identity changes. Neither branch unsubscribes: a debug import can
    // replace the session under this same route (bumping only the session
    // generation), and a Turtle→Cyberman or Commander→Turtle replacement
    // must reselect identities instead of keeping the previous game's.
    let commanderDone = false;
    let lastHordeKey: string | null = null;
    let lastGeneration = useGameStore.getState().gameSessionGeneration;
    // A generation change is a session replacement, never continuous play
    // (engine snapshots commit without bumping it — only init, resume,
    // and import do). Reset both branches and reseed the random fallback
    // for the replacement snapshot's seats, so a replacement neither
    // branch claims sheds the previous game's themed maps instead of
    // keeping them.
    const reselectOnReplace = (state: ReturnType<typeof useGameStore.getState>) => {
      if (state.gameId !== gameId || state.gameSessionGeneration === lastGeneration) return;
      lastGeneration = state.gameSessionGeneration;
      commanderDone = false;
      lastHordeKey = null;
      // The count comes from the INSTALLED replacement snapshot, never the
      // mounted route: a debug import replaces the session under the same
      // route id without navigating, and the replacement game can seat more
      // players than the route's count — reseeding from the route would
      // leave the extra seats with generic labels instead of identities.
      const replacementSeats = state.gameState ? getSeatCount(state.gameState) : 0;
      setupRandomAvatars(replacementSeats > 0 ? replacementSeats : (playerCount ?? 2), gameId);
    };
    // The projected Horde identity this snapshot themes, or null when no
    // themed seats apply (non-Horde format, other challenge deck, or no
    // Boss deployed yet). Bound to the game id and the session generation
    // as well as the projection: a debug import replaces the session under
    // the same route id and can reuse the same object ids, so an id-only
    // key would match a different game and keep its stale names.
    const hordeKeyFor = (
      gameState: NonNullable<ReturnType<typeof useGameStore.getState>["gameState"]>,
      generation: number,
    ): string | null => {
      if (gameState.format_config?.format !== "Horde") return null;
      if (gameState.format_config?.horde_ruleset?.challenge_deck !== "TurtleTeamUpHorde") {
        return null;
      }
      const horde = gameState.derived?.horde;
      if (!horde || (horde.deployed_boss_ids?.length ?? 0) === 0) return null;
      return JSON.stringify([
        gameId,
        generation,
        horde.horde_seat_ids ?? [],
        horde.hero_player_ids ?? [],
        horde.deployed_boss_ids ?? [],
      ]);
    };
    const applyCommanderAvatars = (state: ReturnType<typeof useGameStore.getState>) => {
      if (commanderDone || state.gameId !== gameId || !state.gameState) return false;
      return setupCommanderAvatars(state.gameState);
    };
    const applyHordeAvatars = (state: ReturnType<typeof useGameStore.getState>) => {
      if (state.gameId !== gameId || !state.gameState) return false;
      const key = hordeKeyFor(state.gameState, state.gameSessionGeneration);
      if (key === null) return false;
      // Identity unchanged: themed seats are already active, so neither a
      // rewrite (which would clobber a user rename) nor a refetch is due.
      // Returning true keeps the commander fallback short-circuited.
      if (key === lastHordeKey) return true;
      if (!setupHordeAvatars(state.gameState, gameId)) return false;
      lastHordeKey = key;
      return true;
    };
    const unsub = useGameStore.subscribe((state) => {
      reselectOnReplace(state);
      if (applyHordeAvatars(state)) return;
      if (applyCommanderAvatars(state)) {
        commanderDone = true;
      }
    });
    const state = useGameStore.getState();
    reselectOnReplace(state);
    if (!applyHordeAvatars(state) && applyCommanderAvatars(state)) {
      commanderDone = true;
    }
    return unsub;
  }, [mode, gameId, playerCount]);

  return (
    <GameDispatchContext.Provider value={dispatchAction}>
      {children}
    </GameDispatchContext.Provider>
  );
}
