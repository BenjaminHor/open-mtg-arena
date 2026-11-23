import { act } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assignRandomAvatars } from "../../services/playerAvatars.ts";
import { useGameStore } from "../../stores/gameStore.ts";
import { useMultiplayerStore } from "../../stores/multiplayerStore.ts";
import {
  buildCommanderFormatConfig,
  buildGameState,
  buildPlayers,
} from "../../test/factories/gameStateFactory.ts";
import { GameProvider } from "../GameProvider.tsx";

function expectedRandom(playerCount: number, seed: string) {
  return new Map(
    assignRandomAvatars(playerCount, seed).map((avatar, playerId) => [
      playerId,
      { kind: "card" as const, cardName: avatar.cardName },
    ]),
  );
}

describe("GameProvider semantic visual avatars", () => {
  beforeEach(() => {
    localStorage.clear();
    useMultiplayerStore.setState({
      playerNames: new Map(),
      playerAvatars: new Map(),
    });
    useGameStore.setState({
      adapter: null,
      gameId: null,
      gameState: null,
      gameMode: null,
      waitingFor: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("installs the complete seeded random identity map synchronously", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(
      <GameProvider gameId="avatar-random" mode="ai" playerCount={3}>
        <div />
      </GameProvider>,
    );

    expect(useMultiplayerStore.getState().playerAvatars).toEqual(
      expectedRandom(3, "avatar-random"),
    );
    expect(useMultiplayerStore.getState().playerNames.get(0)).toBe("You");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("replaces random identities with the first commander for each owner", () => {
    render(
      <GameProvider gameId="avatar-commanders" mode="ai" playerCount={2}>
        <div />
      </GameProvider>,
    );

    act(() => {
      useGameStore.setState({
        gameId: "avatar-commanders",
        gameState: {
          ...buildGameState({ players: buildPlayers([{ id: 0 }, { id: 1 }]) }),
          command_zone: [10, 11, 12],
          objects: {
            10: { name: "Atraxa, Praetors' Voice", owner: 0, is_commander: true },
            11: { name: "Ignored Partner", owner: 0, is_commander: true },
            12: { name: "Niv-Mizzet Reborn", owner: 1, is_commander: true },
          },
        } as never,
      });
    });

    expect(useMultiplayerStore.getState().playerAvatars).toEqual(new Map([
      [0, { kind: "card", cardName: "Atraxa, Praetors' Voice" }],
      [1, { kind: "card", cardName: "Niv-Mizzet Reborn" }],
    ]));
  });

  /**
   * Issue #8053. The commander derivation used to be gated on a non-empty
   * `command_zone`, which is only what sits in the command zone at that instant
   * (`viewmodel/commanderColumn.ts` reads it that way). By turn 34 a commander
   * is usually on the battlefield — or in its graveyard or exile — so the list
   * is empty, the derivation was skipped, and a reload kept the seeded random
   * planeswalker identities instead of the commander ones the player had been
   * looking at. Every seat's name and avatar visibly changed.
   */
  it("keeps commander identities when a reload lands with the commander out of the command zone", () => {
    const gameId = "avatar-mid-game-reload";
    render(
      <GameProvider gameId={gameId} mode="ai" playerCount={2}>
        <div />
      </GameProvider>,
    );
    // The page starts here on a reload: the random fallback is installed before
    // the resumed state arrives.
    expect(useMultiplayerStore.getState().playerAvatars).toEqual(expectedRandom(2, gameId));

    act(() => {
      useGameStore.setState({
        gameId,
        gameState: {
          ...buildGameState({ players: buildPlayers([{ id: 0 }, { id: 1 }]) }),
          command_zone: [],
          objects: {
            40: { name: "Atraxa, Praetors' Voice", owner: 0, is_commander: true, zone: "Battlefield" },
            41: { name: "Muldrotha, the Gravetide", owner: 1, is_commander: true, zone: "Graveyard" },
          },
        } as never,
      });
    });

    expect(useMultiplayerStore.getState().playerNames).toEqual(
      new Map([[0, "Atraxa"], [1, "Muldrotha"]]),
    );
    expect(useMultiplayerStore.getState().playerAvatars).toEqual(new Map([
      [0, { kind: "card", cardName: "Atraxa, Praetors' Voice" }],
      [1, { kind: "card", cardName: "Muldrotha, the Gravetide" }],
    ]));
  });

  it("does not wipe the seeded identities for a state that carries no commander", () => {
    const gameId = "avatar-no-commander";
    render(
      <GameProvider gameId={gameId} mode="ai" playerCount={2}>
        <div />
      </GameProvider>,
    );

    act(() => {
      useGameStore.setState({
        gameId,
        gameState: {
          ...buildGameState({ players: buildPlayers([{ id: 0 }, { id: 1 }]) }),
          objects: { 50: { name: "Sol Ring", owner: 0, zone: "Battlefield" } },
        } as never,
      });
    });

    // A non-Commander game keeps the random identity map it started with rather
    // than having it replaced with the empty maps a commander scan would build.
    expect(useMultiplayerStore.getState().playerAvatars).toEqual(expectedRandom(2, gameId));
    expect(useMultiplayerStore.getState().playerNames.get(0)).toBe("You");

    // ...and the derivation is still listening, so a commander that lands in a
    // later snapshot is picked up instead of being missed by a one-shot check.
    act(() => {
      useGameStore.setState({
        gameState: {
          ...buildGameState({ players: buildPlayers([{ id: 0 }, { id: 1 }]) }),
          objects: {
            51: { name: "Kinnan, Bonder Prodigy", owner: 0, is_commander: true, zone: "Command" },
            52: { name: "Muldrotha, the Gravetide", owner: 1, is_commander: true, zone: "Battlefield" },
          },
        } as never,
      });
    });
    expect(useMultiplayerStore.getState().playerNames).toEqual(
      new Map([[0, "Kinnan"], [1, "Muldrotha"]]),
    );
  });

});
