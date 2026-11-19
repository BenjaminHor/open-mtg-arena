// The events one player may see (docs/architecture.md, "Hidden information"). Hosts filter events with this before the
// UI or AI gets them, as `playerView` does for state.

import type { GameEvent } from "../state/events.ts";
import type { PlayerId } from "../state/ids.ts";
import type { ZoneRef } from "../state/zones.ts";
import { canSee } from "./visibility.ts";

/** An event as one player sees it: the event itself, or what's left of it when it would reveal a hidden card. */
export type ViewEvent =
  | GameEvent
  /** A card moved between zones the viewer can't see into (another player's library to their hand, say). */
  | { type: "HIDDEN_CARD_MOVED"; from: ZoneRef; to: ZoneRef }
  /** Another player drew a card (CR 121.1); which one is hidden. */
  | { type: "HIDDEN_CARD_DRAWN"; player: PlayerId };

/** Every event, in order, as `viewer` may see it. */
export function eventsFor(events: readonly GameEvent[], viewer: PlayerId): ViewEvent[] {
  return events.map((e) => eventFor(e, viewer));
}

/** Exhaustive, so every new event has to decide what it reveals. */
function eventFor(e: GameEvent, viewer: PlayerId): ViewEvent {
  switch (e.type) {
    case "ZONE_CHANGED":
      // The card is seen if it's in a zone the viewer sees before or after; otherwise only that a card moved.
      // Known issue (docs/status.md): a card's card id and old object id let another player follow it through a hidden
      // hand (CR 402.3), for example a cancelled spell back in hand, told apart from a second copy cast later.
      return canSee(e.from, viewer) || canSee(e.to, viewer) ? e : { type: "HIDDEN_CARD_MOVED", from: e.from, to: e.to };
    case "CARD_DRAWN":
      return e.player === viewer ? e : { type: "HIDDEN_CARD_DRAWN", player: e.player };
    // Everything else names only public objects or facts: cards on the stack or battlefield, a discard (CR 701.9, the
    // card goes to a public graveyard), a cancelled cast's card (it was on the stack), players and numbers.
    case "STARTING_PLAYER_CHOSEN":
    case "LIBRARY_SHUFFLED":
    case "MULLIGAN_DECLARED":
    case "TURN_BEGAN":
    case "STEP_BEGAN":
    case "PRIORITY_PASSED":
    case "LAND_PLAYED":
    case "ATTACKERS_DECLARED":
    case "BLOCKERS_DECLARED":
    case "SPELL_CAST":
    case "CAST_CANCELLED":
    case "ABILITY_ACTIVATED":
    case "ACTIVATION_CANCELLED":
    case "ABILITY_DID_NOT_RESOLVE":
    case "SPELL_DID_NOT_RESOLVE":
    case "SPELL_RESOLVED":
    case "ABILITY_RESOLVED":
    case "MANA_EMPTIED":
    case "PERMANENT_UNTAPPED":
    case "PERMANENT_TAPPED":
    case "MANA_ADDED":
    case "DAMAGE_DEALT":
    case "LIFE_LOST":
    case "EFFECT_CREATED":
    case "EFFECT_ENDED":
    case "DAMAGE_REMOVED":
    case "CARD_DISCARDED":
    case "STATE_BASED_ACTIONS":
    case "PERMANENT_DESTROYED":
    case "PLAYER_LOST":
    case "GAME_ENDED":
      return e;
  }
}
