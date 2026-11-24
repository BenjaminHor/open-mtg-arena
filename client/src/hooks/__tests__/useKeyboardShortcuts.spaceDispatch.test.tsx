import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameAction, GameEvent, GameState, WaitingFor } from "../../adapter/types";
import type { GameMode } from "../../stores/gameStore";
import { useGameStore } from "../../stores/gameStore";
import { useUiStore } from "../../stores/uiStore";
import {
  buildGameState,
  buildManaPaymentWaitingFor,
  buildPriorityWaitingFor,
} from "../../test/factories/gameStateFactory";
import { useKeyboardShortcuts } from "../useKeyboardShortcuts";

const dispatchActionMock = vi.hoisted(() => vi.fn<(action: GameAction) => Promise<void>>());
type LegacyDispatch = (action: GameAction) => Promise<GameEvent[]>;

vi.mock("../../game/dispatch", () => ({
  dispatchAction: dispatchActionMock,
}));

function KeyboardHarness() {
  useKeyboardShortcuts();
  return null;
}

function resetStores(): void {
  act(() => {
    useGameStore.getState().reset();
    useUiStore.setState({ helpSheetOpen: false });
  });
}

function seedGame(
  gameMode: GameMode | null,
  waitingFor: WaitingFor | null,
  options: {
    gameState?: GameState | null;
    legacyDispatch?: LegacyDispatch;
  } = {},
) {
  let legacyDispatch!: LegacyDispatch;
  act(() => {
    legacyDispatch = setGameStores(gameMode, waitingFor, options);
  });
  return legacyDispatch;
}

function setGameStores(
  gameMode: GameMode | null,
  waitingFor: WaitingFor | null,
  options: {
    gameState?: GameState | null;
    legacyDispatch?: LegacyDispatch;
  } = {},
): LegacyDispatch {
  const legacyDispatch = options.legacyDispatch ?? vi.fn<LegacyDispatch>().mockResolvedValue([]);
  const gameState = options.gameState === undefined
    ? waitingFor ? buildGameState({ waiting_for: waitingFor }) : null
    : options.gameState;

  useGameStore.setState({
    gameMode,
    gameState,
    waitingFor,
    dispatch: legacyDispatch,
    stateHistory: [],
  });

  return legacyDispatch;
}

function pressSpace(): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", cancelable: true }));
  });
}

function dispatchSpaceKeydown(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: " ", cancelable: true });
  window.dispatchEvent(event);
  return event;
}

function mountKeyboard(): void {
  render(<KeyboardHarness />);
}

describe("Space priority dispatch authorization", () => {
  beforeEach(() => {
    dispatchActionMock.mockReset();
    dispatchActionMock.mockResolvedValue(undefined);
    resetStores();
  });

  afterEach(() => {
    cleanup();
    resetStores();
  });

  it("sends an authorized local Priority pass once through canonical dispatch only", () => {
    const waitingFor = buildPriorityWaitingFor({ data: { player: 0 } });
    const legacyDispatch = seedGame("ai", waitingFor);
    mountKeyboard();

    pressSpace();

    expect(dispatchActionMock).toHaveBeenCalledOnce();
    expect(dispatchActionMock).toHaveBeenCalledWith({ type: "PassPriority" });
    expect(legacyDispatch).not.toHaveBeenCalled();
  });

  it("submits neither path when another seat owns local Priority", () => {
    const waitingFor = buildPriorityWaitingFor({ data: { player: 1 } });
    const legacyDispatch = seedGame("ai", waitingFor, {
      gameState: buildGameState({ waiting_for: waitingFor, active_player: 1, priority_player: 1 }),
    });
    mountKeyboard();

    pressSpace();

    expect(dispatchActionMock).not.toHaveBeenCalled();
    expect(legacyDispatch).not.toHaveBeenCalled();
  });

  it("allows the authorized turn-decision controller to pass Priority", () => {
    // CR 723: seat 0 controls the active player's (seat 1's) decisions.
    const waitingFor = buildPriorityWaitingFor({ data: { player: 1 } });
    const gameState = buildGameState({
      waiting_for: waitingFor,
      active_player: 1,
      priority_player: 0,
      turn_decision_controller: 0,
    });
    const legacyDispatch = seedGame("ai", waitingFor, { gameState });
    mountKeyboard();

    pressSpace();

    expect(dispatchActionMock).toHaveBeenCalledOnce();
    expect(dispatchActionMock).toHaveBeenCalledWith({ type: "PassPriority" });
    expect(legacyDispatch).not.toHaveBeenCalled();
  });

  it("submits neither path while watching a replay", () => {
    const waitingFor = buildPriorityWaitingFor({ data: { player: 0 } });
    const legacyDispatch = seedGame("spectate", waitingFor);
    mountKeyboard();

    pressSpace();

    expect(dispatchActionMock).not.toHaveBeenCalled();
    expect(legacyDispatch).not.toHaveBeenCalled();
  });

  it("submits neither path when the game state is missing", () => {
    const waitingFor = buildPriorityWaitingFor({ data: { player: 0 } });
    const legacyDispatch = seedGame("ai", waitingFor, { gameState: null });
    mountKeyboard();

    pressSpace();

    expect(dispatchActionMock).not.toHaveBeenCalled();
    expect(legacyDispatch).not.toHaveBeenCalled();
  });

  it("submits neither path outside Priority", () => {
    const waitingFor = buildManaPaymentWaitingFor();
    const legacyDispatch = seedGame("ai", waitingFor);
    mountKeyboard();

    pressSpace();

    expect(dispatchActionMock).not.toHaveBeenCalled();
    expect(legacyDispatch).not.toHaveBeenCalled();
  });

  it("tracks authorized to unauthorized to authorized changes while mounted", () => {
    const firstLegacyDispatch = seedGame(
      "ai",
      buildPriorityWaitingFor({ data: { player: 0 } }),
    );
    mountKeyboard();
    pressSpace();
    expect(dispatchActionMock).toHaveBeenCalledTimes(1);
    expect(firstLegacyDispatch).not.toHaveBeenCalled();

    resetStores();
    const unauthorizedWaitingFor = buildPriorityWaitingFor({ data: { player: 1 } });
    const unauthorizedGameState = buildGameState({
      waiting_for: unauthorizedWaitingFor,
      active_player: 1,
      priority_player: 1,
    });
    const unauthorizedLegacyDispatch = seedGame(
      "ai",
      unauthorizedWaitingFor,
      {
        gameState: unauthorizedGameState,
      },
    );
    pressSpace();
    expect(dispatchActionMock).toHaveBeenCalledTimes(1);
    expect(unauthorizedLegacyDispatch).not.toHaveBeenCalled();

    resetStores();
    const finalLegacyDispatch = seedGame(
      "ai",
      buildPriorityWaitingFor({ data: { player: 0 } }),
    );
    pressSpace();
    expect(dispatchActionMock).toHaveBeenCalledTimes(2);
    expect(finalLegacyDispatch).not.toHaveBeenCalled();

    expect(dispatchActionMock).toHaveBeenNthCalledWith(1, { type: "PassPriority" });
    expect(dispatchActionMock).toHaveBeenNthCalledWith(2, { type: "PassPriority" });
  });

  it("uses the current Priority actor when player 0 loses Priority in the same act", () => {
    seedGame("ai", buildPriorityWaitingFor({ data: { player: 0 } }));
    mountKeyboard();

    const nextWaitingFor = buildPriorityWaitingFor({ data: { player: 1 } });
    const currentState = buildGameState({
      waiting_for: nextWaitingFor,
      active_player: 1,
      priority_player: 1,
    });
    let legacyDispatch!: LegacyDispatch;
    let event!: KeyboardEvent;

    act(() => {
      legacyDispatch = setGameStores("ai", nextWaitingFor, { gameState: currentState });
      event = dispatchSpaceKeydown();
      expect(dispatchActionMock).not.toHaveBeenCalled();
    });

    expect(dispatchActionMock).not.toHaveBeenCalled();
    expect(legacyDispatch).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("uses the current Priority actor when player 0 gains Priority in the same act", () => {
    const previousWaitingFor = buildPriorityWaitingFor({ data: { player: 1 } });
    seedGame("ai", previousWaitingFor, {
      gameState: buildGameState({
        waiting_for: previousWaitingFor,
        active_player: 1,
        priority_player: 1,
      }),
    });
    mountKeyboard();

    const nextWaitingFor = buildPriorityWaitingFor({ data: { player: 0 } });
    const currentState = buildGameState({ waiting_for: nextWaitingFor, active_player: 0, priority_player: 0 });
    let legacyDispatch!: LegacyDispatch;
    let event!: KeyboardEvent;

    act(() => {
      legacyDispatch = setGameStores("ai", nextWaitingFor, { gameState: currentState });
      event = dispatchSpaceKeydown();
      expect(dispatchActionMock).toHaveBeenCalledExactlyOnceWith({ type: "PassPriority" });
    });

    expect(dispatchActionMock).toHaveBeenCalledExactlyOnceWith({ type: "PassPriority" });
    expect(legacyDispatch).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

});
