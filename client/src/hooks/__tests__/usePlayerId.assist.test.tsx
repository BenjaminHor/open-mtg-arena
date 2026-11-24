/**
 * Runtime test for the CR 702.132a Assist acting-player routing fix in
 * `waitingPlayer`. Under an `AssistPayment` waiting state the CHOSEN helper is
 * the actor (the prompt carries `caster`/`chosen`, no `player` field). These
 * tests drive `useCanActForWaitingState` through that branch: it must be true
 * for the `chosen` seat and false for the `caster` seat. Reverting the
 * `AssistPayment` branch makes `waitingPlayer` return null (no `player` field),
 * which flips the `chosen`-seat assertion to false.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GameState, WaitingFor } from "../../adapter/types";
import { useGameStore } from "../../stores/gameStore";
import {
  buildAssistPaymentWaitingFor,
  buildGameState,
  buildManaPaymentWaitingFor,
  buildPlayers,
} from "../../test/factories/gameStateFactory.ts";
import { useCanActForWaitingState } from "../usePlayerId";

function createGameState(): GameState {
  return buildGameState({
    active_player: 1,
    players: buildPlayers([0, 1]),
    priority_player: 1,
    next_object_id: 100,
    waiting_for: buildManaPaymentWaitingFor(),
    has_pending_cast: true,
    turn_decision_controller: 1,
  });
}

/** Seat the Assist payment so the local human (always seat 0) is `role`. */
function seatLocalAs(role: "chosen" | "caster") {
  const waitingFor: WaitingFor = buildAssistPaymentWaitingFor({
    data: role === "chosen"
      ? { caster: 1, chosen: 0, max_generic: 3 }
      : { caster: 0, chosen: 1, max_generic: 3 },
  });
  useGameStore.setState({
    gameMode: "ai",
    gameState: createGameState(),
    waitingFor,
  });
}

describe("useCanActForWaitingState — Assist payment routing (CR 702.132a)", () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  afterEach(() => {
    useGameStore.getState().reset();
  });

  it("is true for the chosen helper seat", () => {
    seatLocalAs("chosen");
    const { result } = renderHook(() => useCanActForWaitingState());
    expect(result.current).toBe(true);
  });

  it("is false for the caster seat", () => {
    seatLocalAs("caster"); // the caster, not the helper
    const { result } = renderHook(() => useCanActForWaitingState());
    expect(result.current).toBe(false);
  });

  it("authorizes the CR 723 turn controller for the active player's payment choice", () => {
    // Seat 0 (the local human) controls the active player's (seat 1's) turn.
    const waitingFor: WaitingFor = {
      type: "ResolutionOptionalPaymentChoice",
      data: { player: 1, source_id: 7, costs: [] },
    };
    useGameStore.setState({
      gameMode: "ai",
      gameState: buildGameState({
        active_player: 1,
        players: buildPlayers([0, 1]),
        priority_player: 1,
        waiting_for: waitingFor,
        turn_decision_controller: 0,
      }),
      waitingFor,
    });

    const { result } = renderHook(() => useCanActForWaitingState());
    expect(result.current).toBe(true);
  });
});
