import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PersistedGameState } from "../../adapter/types";
import { buildGameState, buildPlayers } from "../../test/factories/gameStateFactory";

const { loadGame } = vi.hoisted(() => ({ loadGame: vi.fn() }));

vi.mock("../../services/gamePersistence", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../services/gamePersistence")>(),
  loadGame,
}));

import { useResumables } from "../useResumables";
import { loadActiveGame, saveActiveGame, type ActiveGameMeta } from "../../services/gamePersistence";

function renderResumables() {
  return renderHook(
    () => ({ resumables: useResumables(), location: useLocation() }),
    { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> },
  );
}

beforeEach(() => {
  localStorage.clear();
  loadGame.mockReset();
});

afterEach(() => cleanup());

describe("useResumables — the saved match", () => {
  it("offers a saved AI match with its turn and life summary, and routes back to it", async () => {
    loadGame.mockResolvedValue(
      buildGameState({ turn_number: 4, active_player: 0, players: buildPlayers([0, 1, 2]) }) as PersistedGameState,
    );
    saveActiveGame({
      id: "ai-game",
      mode: "ai",
      difficulty: "Hard",
      aiSeats: [{ difficulty: "Hard" }, { difficulty: "Hard" }],
    });

    const { result } = renderResumables();
    await waitFor(() => expect(result.current.resumables.match?.id).toBe("ai-game"));
    expect(result.current.resumables.matchSummary).toMatchObject({
      turn: 4,
      isYourTurn: true,
      opponentCount: 2,
    });

    act(() => result.current.resumables.resumeMatch());
    expect(result.current.location.pathname).toBe("/game/ai-game");
    expect(result.current.location.search).toBe("?mode=ai&difficulty=Hard&players=3");
  });

  it("clears the pointer when the saved state behind it is gone", async () => {
    loadGame.mockResolvedValue(null);
    saveActiveGame({ id: "vanished", mode: "ai", difficulty: "Medium" });

    const { result } = renderResumables();
    await waitFor(() => expect(loadActiveGame()).toBeNull());
    expect(result.current.resumables.match).toBeNull();
  });

  it("a lookup that settles late cannot clear a newer pointer", async () => {
    let resolveFirst!: (value: PersistedGameState | null) => void;
    loadGame.mockImplementationOnce(
      () => new Promise<PersistedGameState | null>((resolve) => { resolveFirst = resolve; }),
    );
    saveActiveGame({ id: "first", mode: "ai", difficulty: "Medium" });
    const { result } = renderResumables();
    await waitFor(() => expect(loadGame).toHaveBeenCalledOnce());

    const replacement: ActiveGameMeta = { id: "replacement", mode: "ai", difficulty: "Medium" };
    loadGame.mockResolvedValue(buildGameState() as PersistedGameState);
    // The storage notification starts a second validation for the replacement.
    act(() => saveActiveGame(replacement));
    await waitFor(() => expect(result.current.resumables.match?.id).toBe("replacement"));

    await act(async () => { resolveFirst(null); });

    expect(loadActiveGame()).toEqual(replacement);
    expect(result.current.resumables.match?.id).toBe("replacement");
  });
});
