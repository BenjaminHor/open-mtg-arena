import { create } from "zustand";
import i18n from "i18next";

import type { PlayerAvatarIdentity } from "../services/playerAvatars.ts";

/**
 * Who sits in each seat of the current game: the names and avatars the HUD
 * shows for every player. A game against the AI has several seats, so this is
 * "multiplayer" in the multi-seat sense; the app has no online play.
 *
 * Ephemeral: `GameProvider` assigns both maps when a game starts or resumes.
 */
interface MultiplayerState {
  /** PlayerId → display name, assigned at game start. */
  playerNames: Map<number, string>;
  /** PlayerId → semantic avatar identity, assigned at game start. */
  playerAvatars: Map<number, PlayerAvatarIdentity>;
}

export const useMultiplayerStore = create<MultiplayerState>()(() => ({
  playerNames: new Map(),
  playerAvatars: new Map(),
}));

export function getPlayerDisplayName(playerId: number, myId?: number): string {
  if (playerId === myId) return i18n.t("game:player.you");
  return getOpponentDisplayName(playerId);
}

export function getOpponentDisplayName(playerId: number): string {
  const state = useMultiplayerStore.getState();
  const name = state.playerNames.get(playerId);
  if (name) return name;
  return i18n.t("game:player.opponent", { seat: playerId + 1 });
}
