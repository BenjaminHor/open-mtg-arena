// When a player may play a land or cast a spell (CR 117.1a, 305.1, 302.1, 304.1, 307.1).

import type { CardDatabase } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { keywordsOf } from "./abilities.ts";
import { cardTypesOf } from "./card-types.ts";

/** Whether it's this player's own main phase with an empty stack: "sorcery speed" (CR 117.1a). */
function mainPhaseEmptyStack(state: GameState, player: PlayerId): boolean {
  const turn = state.turn;
  return (
    turn !== null &&
    turn.activePlayer === player &&
    (turn.step === "precombatMain" || turn.step === "postcombatMain") &&
    state.zones.stack.length === 0
  );
}

/**
 * Why the player can't cast this card now, as far as timing goes, or null. Instants, and cards with flash, any time
 * they have priority (CR 117.1a, 304.1, 702.8a); any other spell in their own main phase with an empty stack
 * (CR 117.1a, 302.1, 307.1). Checked once, before the card moves to the stack (CR 601.2a). Priority itself is checked by
 * the caller.
 */
export function castTimingProblem(
  state: GameState,
  player: PlayerId,
  card: ObjectId,
  cards: CardDatabase,
): string | null {
  const types = cardTypesOf(state, card, cards);
  // A land is played (CR 116.2a, 305.1), never cast, even one that also has another card type (CR 305.9).
  if (types.includes("land")) return "a land is played, not cast";
  // Flash works from the zone the card is cast from (CR 702.8a): its keywords are read in the hand.
  if (types.includes("instant") || keywordsOf(state, card, cards).includes("flash")) return null;
  return mainPhaseEmptyStack(state, player) ? null : "only in your main phase with an empty stack (CR 117.1a)";
}

/**
 * Why the player can't play this land now, or null: a land card, their own main phase, an empty stack (CR 305.1), and
 * fewer lands played this turn than they may play, normally one (CR 305.2).
 */
export function landPlayProblem(
  state: GameState,
  player: PlayerId,
  card: ObjectId,
  cards: CardDatabase,
): string | null {
  if (!cardTypesOf(state, card, cards).includes("land")) return "only a land can be played";
  if (!mainPhaseEmptyStack(state, player)) return "only in your main phase with an empty stack (CR 305.1)";
  if ((state.players[player]?.landsPlayedThisTurn ?? 0) >= 1)
    return "you've already played a land this turn (CR 305.2)";
  return null;
}
