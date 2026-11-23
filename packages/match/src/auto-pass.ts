// Smart auto-pass (ui.md, "The player only makes meaningful decisions"; D-143): the host passes priority for a player
// who has nothing they could do, so the game never stops on an empty choice, and stops them at every window where they
// could act, as Arena does (arena-research.md, "smart priority"). One pure function of the decision, the player's own
// options and their settings, used for every seat alike, the AI's too (D-137). It errs toward stopping.

import { type Action, type CardDatabase, controllerOf, type GameState, mightPayFor, type PlayerId } from "@mtg/engine";
import type { SeatSettings } from "./match-state.ts";

/**
 * Whether the host passes for `player`, who has priority, given their legal actions. Never with auto-pass off (full
 * control). Always when nothing meaningful can be done: only mana abilities, or spells and abilities the player can't
 * pay for now. With their own spell or ability on top of the stack, pass so it resolves (they'd rarely respond to their
 * own, and Arena doesn't stop them). Otherwise stop: an opponent's object can be responded to, and an empty stack is a
 * window to act in.
 */
export function autoPasses(
  state: GameState,
  player: PlayerId,
  actions: readonly Action[],
  settings: SeatSettings,
  cards: CardDatabase,
): boolean {
  if (!settings.autoPass || state.pending?.kind !== "priority" || state.pending.player !== player) return false;
  if (!actions.some((a) => isMeaningful(state, player, a, cards))) return true;
  const top = state.zones.stack.at(-1);
  return top !== undefined && controllerOf(state, top, cards) === player;
}

/** Something worth stopping for: a land to play, or a spell or non-mana ability the player might pay for now. */
function isMeaningful(state: GameState, player: PlayerId, action: Action, cards: CardDatabase): boolean {
  if (action.type === "PLAY_LAND") return true;
  if (action.type !== "CAST_SPELL" && action.type !== "ACTIVATE_ABILITY") return false;
  // A spell with no mana cost has a cost that can't be paid (CR 118.6); a mana ability isn't a reason to stop.
  return mightPayFor(state, player, action, cards) === true;
}
