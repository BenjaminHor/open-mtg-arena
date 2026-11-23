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
 * own, and Arena doesn't stop them). In their own upkeep, draw step and end step with an empty stack, pass too, as
 * Arena does (D-157). Otherwise stop: an opponent's object can be responded to, and an empty stack is a window to act in.
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
  if (top === undefined) return quietOwnStep(state, player);
  return controllerOf(state, top, cards) === player;
}

/**
 * Arena's default skips (arena-research.md, "Default auto-passing"; D-157): no stop in your own upkeep, draw step or
 * end step while the stack is empty. An object on the stack still stops you if it's an opponent's. One of Arena's
 * "smart stops" is kept: mana left in your pool in your end step stops you, as it empties when the step ends (CR 500.5). Your main phases and combat steps, and every step of the opponent's turn, still stop you
 * whenever you could act (D-143): a trick in hand keeps its window after blockers.
 */
function quietOwnStep(state: GameState, player: PlayerId): boolean {
  const turn = state.turn;
  if (turn === null || turn.activePlayer !== player) return false;
  switch (turn.step) {
    case "upkeep":
    case "draw":
      return true;
    case "end": {
      const pool = state.players[player]?.manaPool;
      return pool === undefined || Object.values(pool).every((n) => n === 0);
    }
    default:
      return false;
  }
}

/** Something worth stopping for: a land to play, or a spell or non-mana ability the player might pay for now. */
function isMeaningful(state: GameState, player: PlayerId, action: Action, cards: CardDatabase): boolean {
  if (action.type === "PLAY_LAND") return true;
  if (action.type !== "CAST_SPELL" && action.type !== "ACTIVATE_ABILITY") return false;
  // A spell with no mana cost has a cost that can't be paid (CR 118.6); a mana ability isn't a reason to stop.
  return mightPayFor(state, player, action, cards) === true;
}
