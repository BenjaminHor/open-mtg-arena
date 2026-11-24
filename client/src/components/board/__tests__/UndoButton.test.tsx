import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useGameStore } from "../../../stores/gameStore.ts";
import { buildGameState } from "../../../test/factories/gameStateFactory.ts";
import { UndoButton } from "../UndoButton.tsx";

describe("UndoButton", () => {
  afterEach(() => {
    cleanup();
    useGameStore.setState({ stateHistory: [], gameMode: null });
  });

  it("renders when single-player history exists", () => {
    useGameStore.setState({
      stateHistory: [{ state: buildGameState(), logSeq: 0 }],
      gameMode: "ai",
    });

    render(<UndoButton />);

    expect(screen.getByRole("button", { name: /undo/i })).toBeInTheDocument();
  });

  it("does not render without history", () => {
    useGameStore.setState({ stateHistory: [], gameMode: "ai" });

    render(<UndoButton />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("never renders in the replay viewer, even with history", () => {
    // A replay is a recording this client only steps through — a client-side
    // rewind has nothing to undo, so the affordance stays hidden regardless of history.
    useGameStore.setState({
      stateHistory: [{ state: buildGameState(), logSeq: 0 }],
      gameMode: "spectate",
    });

    render(<UndoButton />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
