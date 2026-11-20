// The events one player may see (docs/architecture.md, "Hidden information"). Hosts filter events with this before the
// UI or AI gets them, as `playerView` does for state.

import type { GameEvent } from "../state/events.ts";
import type { CardId, ObjectId, PlayerId } from "../state/ids.ts";
import type { ZoneRef } from "../state/zones.ts";
import { canSee } from "./visibility.ts";

type ZoneChanged = Extract<GameEvent, { type: "ZONE_CHANGED" }>;
type CastCancelled = Extract<GameEvent, { type: "CAST_CANCELLED" }>;

/**
 * An event as one player sees it: the event itself, or what's left of it when it would reveal a hidden card. Nothing
 * from the side the viewer can't see is shown, not even an id, so a card can't be followed through a hidden zone
 * (D-054).
 */
export type ViewEvent =
  | GameEvent
  /** Another player's cancelled cast: the spell left the stack; where in their hand the card went isn't shown. */
  | (Omit<CastCancelled, "restored"> & { restored: null })
  /** A card moved between zones the viewer can't see into (another player's library to their hand, say). */
  | { type: "HIDDEN_CARD_MOVED"; from: ZoneRef; to: ZoneRef }
  /** A card came into the viewer's sight (cast or played from another player's hand): only what it is now. */
  | { type: "CARD_CAME_INTO_VIEW"; from: ZoneRef; to: ZoneRef; newId: ObjectId; cardId: CardId }
  /** A card went out of the viewer's sight (into another player's hand, say): only what it was. */
  | {
      type: "CARD_LEFT_VIEW";
      from: ZoneRef;
      to: ZoneRef;
      oldId: ObjectId;
      cardId: CardId;
      object: ZoneChanged["object"];
    }
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
      return zoneChangeFor(e, viewer);
    case "CAST_CANCELLED":
      // Everyone saw the spell; only its caster sees where in their hand the card went back (CR 402.3).
      return e.player === viewer ? e : { ...e, restored: null };
    case "CARD_DRAWN":
      return e.player === viewer ? e : { type: "HIDDEN_CARD_DRAWN", player: e.player };
    // Everything else names only public objects or facts: cards on the stack or battlefield, a discard (CR 701.9, the
    // card goes to a public graveyard, with the card id it got coming out of the hand, D-054), players and numbers.
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
    case "PERMANENT_SACRIFICED":
    case "SPELL_COUNTERED":
    case "ABILITY_COUNTERED":
    case "LIFE_GAINED":
    case "PLAYER_LOST":
    case "GAME_ENDED":
      return e;
  }
}

/**
 * A card moving between zones, as `viewer` sees it: in full if they see both zones; if only one, only that side of the
 * move, since the other side's ids (the object in a hidden hand, its card id before it came out, D-054) would let
 * them follow the card where they can't see it; if neither, only that a card moved.
 */
function zoneChangeFor(e: ZoneChanged, viewer: PlayerId): ViewEvent {
  const seesFrom = canSee(e.from, viewer);
  const seesTo = canSee(e.to, viewer);
  if (seesFrom && seesTo) return e;
  if (seesTo) return { type: "CARD_CAME_INTO_VIEW", from: e.from, to: e.to, newId: e.newId, cardId: e.newCardId };
  if (seesFrom) {
    return { type: "CARD_LEFT_VIEW", from: e.from, to: e.to, oldId: e.oldId, cardId: e.cardId, object: e.object };
  }
  return { type: "HIDDEN_CARD_MOVED", from: e.from, to: e.to };
}
