import { useGameStore } from "../stores/gameStore";

/** True when the local client must not submit game actions: it is watching a
 *  replay (`gameMode: "spectate"`), not playing. */
export function useSpectatorMode(): boolean {
  return useGameStore((s) => s.gameMode) === "spectate";
}
