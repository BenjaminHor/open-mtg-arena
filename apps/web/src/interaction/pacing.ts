// How long what happened stays on screen (D-172; ui.md, "The game never jumps", "Pacing for the opponent"): the
// worker cuts the host's run into frames at the events worth seeing, and the app holds each frame this long before the
// next. One table over every event kind, so a new event has to decide. The numbers are guesses to tune with the owner
// [guess], against Arena's floor of 0.4 s for an opponent's stack item [R: arena-research.md §5].

import type { PlayerId, ViewEvent } from "@mtg/engine";

/** ms: the holds, in one place. */
export const HOLD = {
  /** The opponent's spell or ability, on the stack with its targets: long enough to read it. */
  opponentStack: 1000,
  /** A trigger going on the stack. */
  trigger: 600,
  /** An attack or blocks declared. */
  combat: 900,
  /** Something resolved, damage dealt, a creature died: the board changed. */
  outcome: 600,
  /** A land played. */
  land: 700,
  /** The opponent's new turn: the banner says whose, long enough that a quiet turn is seen to pass. */
  turn: 1000,
} as const;

/**
 * Whether the worker keeps a frame where these events happened: one holds, so the person gets a moment to see it. The
 * worker cuts frames by the same table the app holds them by (D-172).
 */
export function worthAFrame(events: readonly ViewEvent[], me: PlayerId): boolean {
  return frameHold(events, me) > 0;
}

/** How long a frame holds: the longest of what its events ask, 0 for a frame of nothing worth a pause. */
export function frameHold(events: readonly ViewEvent[], me: PlayerId): number {
  return events.reduce((longest, e) => Math.max(longest, eventHold(e, me)), 0);
}

/**
 * Whether the person needs a moment to see this event, and how long. Their own choices they've just made (their cast,
 * their attack) aren't held: they saw them happen. What the host did for anyone is.
 */
export function eventHold(e: ViewEvent, me: PlayerId): number {
  switch (e.type) {
    case "SPELL_CAST":
    case "ABILITY_ACTIVATED":
      return e.player === me ? 0 : HOLD.opponentStack;
    case "ABILITY_TRIGGERED":
      return HOLD.trigger;
    // An opponent not attacking isn't worth a pause; not blocking the person's attack is (their attack goes through).
    case "ATTACKERS_DECLARED":
      return e.player === me || e.attacks.length === 0 ? 0 : HOLD.combat;
    case "BLOCKERS_DECLARED":
      return e.player === me ? 0 : HOLD.combat;
    case "LAND_PLAYED":
      return e.player === me ? 0 : HOLD.land;
    // The person's own spell resolving: its effects (damage, a death, tokens) are held themselves; their turn waits
    // for nothing more (UX review).
    case "SPELL_RESOLVED":
    case "ABILITY_RESOLVED":
      return e.controller === me ? 0 : HOLD.outcome;
    case "SPELL_COUNTERED":
    case "ABILITY_COUNTERED":
    case "SPELL_DID_NOT_RESOLVE":
    case "ABILITY_DID_NOT_RESOLVE":
    case "DAMAGE_DEALT":
    case "PERMANENT_DESTROYED":
    case "PERMANENT_SACRIFICED":
    case "TOKEN_CREATED":
      return HOLD.outcome;
    // The person's own turn starts at once, the banner running while they act; the opponent's is held.
    case "TURN_BEGAN":
      return e.activePlayer === me ? 0 : HOLD.turn;
    // Steps pass without a pause of their own (an empty turn would be a dozen of them): the ladder shows each as the
    // frames around it move on. The rest are details of something held above, or not shown on the board at all.
    case "STEP_BEGAN":
    case "ZONE_CHANGED":
    case "STARTING_PLAYER_CHOSEN":
    case "LIBRARY_SHUFFLED":
    case "PUT_ON_LIBRARY_BOTTOM":
    case "CARD_DRAWN":
    case "MULLIGAN_DECLARED":
    case "EXTRA_TURN_ADDED":
    case "PRIORITY_PASSED":
    case "CAST_CANCELLED":
    case "ACTIVATION_CANCELLED":
    case "MANA_EMPTIED":
    case "PERMANENT_UNTAPPED":
    case "ATTACHED":
    case "AURA_HOST_CHOSEN":
    case "NAME_CHOSEN":
    case "OBJECTS_CHOSEN":
    case "UNATTACHED":
    case "SPELL_COPIED":
    case "COPY_CEASED_TO_EXIST":
    case "TOKEN_CEASED_TO_EXIST":
    case "COUNTERS_PUT":
    case "COUNTERS_REMOVED":
    case "PERMANENT_TAPPED":
    case "MANA_ADDED":
    case "TAPPED_FOR_MANA":
    case "BECAME_TARGET":
    case "LIFE_LOST":
    case "LIFE_GAINED":
    case "EFFECT_CREATED":
    case "EFFECT_ENDED":
    case "DAMAGE_REMOVED":
    case "DAMAGE_PREVENTED":
    case "PERMANENT_REGENERATED":
    case "CARDS_REVEALED":
    case "CARD_DISCARDED":
    case "STATE_BASED_ACTIONS":
    case "PLAYER_LOST":
    case "GAME_ENDED":
    case "HIDDEN_CARD_MOVED":
    case "CARD_CAME_INTO_VIEW":
    case "CARD_LEFT_VIEW":
    case "HIDDEN_TOKEN_CEASED_TO_EXIST":
    case "HIDDEN_CARD_DRAWN":
      return 0;
  }
}
