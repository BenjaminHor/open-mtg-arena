// Whether an effect forbids a player to cast spells at all (CR 601.3): "Your opponents can't cast spells this turn"
// (Silence). "Can't" beats "can" (CR 101.2), so it's checked before anything that would allow the cast.

import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";

export function cantCastSpells(state: GameState, player: PlayerId): boolean {
  return state.effects.some((e) => e.change.kind === "cantCastSpells" && e.change.players.includes(player));
}
