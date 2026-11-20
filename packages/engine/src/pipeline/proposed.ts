// What can happen in the game: each change a rule or effect makes is proposed as one of these and carried out by
// `happen` (happen.ts), so replacement and prevention effects (later: CR 614–616) and triggered abilities
// (later: CR 603.2) have one place to see it.
//
// Each event changes one object or player (or, for damage, is one damage event, CR 120.4); events that happen at the
// same time are one `simultaneous` event. An event is performed whole: destroying a permanent is moving it to the
// graveyard (CR 701.8a), not a destruction followed by a separate zone change, so a "would die" replacement and a
// "would be destroyed" one apply to the same event, in the order its controller chooses (later: CR 616.1, 616.1f).

import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { ManaType } from "../state/mana.ts";
import type { Target } from "../state/objects.ts";
import type { ZoneRef } from "../state/zones.ts";
import type { Destination } from "../zones/move-card.ts";

/** `source` deals `amount` damage to `to`; `combat` for combat damage (CR 120.2a), which some abilities care about. */
export type Damage = { source: ObjectId; to: Target; amount: number; combat: boolean };

/**
 * Where a replacement sends a card that an action would put into a graveyard (CR 614.1a: "... instead"). Only the
 * destination changes: the card is still destroyed, sacrificed, countered or discarded, as the cards' rulings read it
 * (Leyline of the Void: a card exiled instead of going to the graveyard was still discarded, so madness works), and a
 * cost paid this way is still paid (CR 118.11).
 */
export type Rerouted = Exclude<Destination, { zone: "graveyard" }>;

/** One event, performed whole. */
export type SingleEvent =
  /** A card moves to another zone, becoming a new object (CR 400.7). */
  | { kind: "moveCard"; object: ObjectId; to: Destination }
  /**
   * A permanent is destroyed: it moves to its owner's graveyard (CR 701.8a). `to`: where a replacement sends it instead;
   * it's still destroyed (see `Rerouted`).
   */
  | { kind: "destroy"; object: ObjectId; to?: Rerouted; noRegeneration?: true }
  /**
   * Regenerating a permanent, in place of its destruction (CR 701.19a): a shield is used up, all its damage removed, its
   * controller taps it, and it leaves combat. Performed whole, as one event.
   */
  | { kind: "regenerate"; object: ObjectId }
  /** A permanent is sacrificed: its controller moves it to its owner's graveyard; it isn't destroyed (CR 701.21a). */
  | { kind: "sacrifice"; object: ObjectId; to?: Rerouted }
  /**
   * One damage event (CR 120.4): spells deal damage to one recipient, combat damage to many at once (CR 510.2). Its
   * results (life loss, marked damage) are part of it: replacements that change them modify this event
   * (later: CR 120.4c).
   */
  | { kind: "dealDamage"; damage: Damage[] }
  /** A spell or ability on the stack is countered (CR 701.6a); a spell goes to its owner's graveyard with it. */
  | { kind: "counterObject"; object: ObjectId; to?: Rerouted }
  /** A player gains life (CR 119.3). */
  | { kind: "gainLife"; player: PlayerId; amount: number }
  /** A player loses life (CR 119.3), other than from damage, whose life loss is part of the damage event. */
  | { kind: "loseLife"; player: PlayerId; amount: number }
  /** Cards are revealed to every player (CR 701.20a); they stay where they are (CR 701.20b). */
  | { kind: "reveal"; from: ZoneRef; objects: ObjectId[] }
  /** The top cards of a library are put back in this order, top first (CR 401.4); nothing leaves the library. */
  | { kind: "reorderLibrary"; player: PlayerId; top: ObjectId[] }
  /** A permanent becomes tapped (CR 701.26a). */
  | { kind: "tap"; object: ObjectId }
  /** A permanent becomes untapped (CR 701.26b). */
  | { kind: "untap"; object: ObjectId }
  /** Mana goes into a player's mana pool (CR 106.4), made by an ability of `source`. */
  | { kind: "addMana"; player: PlayerId; mana: ManaType; amount: number; source: ObjectId }
  /** A player draws one card (CR 121.1, 121.2). */
  | { kind: "draw"; player: PlayerId }
  /** A card is discarded: it moves from its owner's hand to their graveyard (CR 701.9a). */
  | { kind: "discard"; object: ObjectId; to?: Rerouted }
  /** A player shuffles their library (CR 701.24a). */
  | { kind: "shuffle"; player: PlayerId }
  /**
   * A player plays a land (CR 305.1): it enters the battlefield, and counts toward their land plays (CR 305.2).
   * `tapped`: a replacement has it enter tapped (CR 614.1d).
   */
  | { kind: "playLand"; player: PlayerId; object: ObjectId; tapped?: true };

/** Where a land played goes: its player's battlefield, tapped if a replacement said so. */
export function playLandDestination(event: Extract<SingleEvent, { kind: "playLand" }>): Destination {
  const to = { zone: "battlefield", controller: event.player } as const;
  return event.tapped === true ? { ...to, tapped: true } : to;
}

export type ProposedEvent =
  | SingleEvent
  /**
   * Several events at the same time, as one: the state-based actions of one check (CR 704.3), a step's turn-based
   * action on several permanents (CR 502.3, 508.1f), the cleanup discard (CR 514.1). Every member is replaced against
   * the state before any of them happens (several replacements on one, later: CR 616.1), then all are performed, and triggered abilities see
   * them together (later: CR 603.2).
   */
  | { kind: "simultaneous"; events: SingleEvent[] };
