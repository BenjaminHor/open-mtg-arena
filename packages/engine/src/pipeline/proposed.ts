// What can happen in the game: every change a rule or effect makes is proposed as one of these and carried out by
// `happen` (happen.ts), so replacement and prevention effects (later: CR 614–616) and triggered abilities
// (later: CR 603.2) have one place to see it.

import type { Progress } from "../game/progress.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { ManaType } from "../state/mana.ts";
import type { Target } from "../state/objects.ts";
import type { Destination } from "../zones/move-card.ts";

/** `source` deals `amount` damage to `to`; `combat` for combat damage (CR 120.2a), which some abilities care about. */
export type Damage = { source: ObjectId; to: Target; amount: number; combat: boolean };

export type ProposedEvent =
  /** A card moves to another zone, becoming a new object (CR 400.7). */
  | { kind: "moveCard"; object: ObjectId; to: Destination }
  /** A permanent is destroyed (CR 701.8): it moves to its owner's graveyard. */
  | { kind: "destroy"; object: ObjectId }
  /** One damage event (CR 120.4): spells deal damage to one recipient, combat damage to many at once (CR 510.2). */
  | { kind: "dealDamage"; damage: Damage[] }
  /** A player loses life (CR 119.3). */
  | { kind: "loseLife"; player: PlayerId; amount: number }
  /** Damage is marked on a creature (CR 120.3e). */
  | { kind: "markDamage"; object: ObjectId; amount: number }
  | { kind: "tap"; object: ObjectId }
  /** These permanents untap all at once (CR 502.3). */
  | { kind: "untap"; objects: ObjectId[] }
  /** Mana goes into a player's mana pool (CR 106.4), made by an ability of `source`. */
  | { kind: "addMana"; player: PlayerId; mana: ManaType; amount: number; source: ObjectId }
  /** A player draws a card (CR 121.1). */
  | { kind: "draw"; player: PlayerId }
  /** These cards are discarded as one action (CR 701.9a). */
  | { kind: "discard"; objects: ObjectId[] }
  /** A player shuffles their library (CR 701.24a). */
  | { kind: "shuffle"; player: PlayerId }
  /** A player plays a land (CR 305.1): it enters the battlefield, and counts toward their land plays (CR 305.2). */
  | { kind: "playLand"; player: PlayerId; object: ObjectId }
  /**
   * Several events at the same time, as one: the state-based actions performed together (CR 704.3), several
   * attackers tapping (CR 508.1f). Each is replaced on its own (later: CR 614), and triggered abilities see them all
   * at once (later: CR 603.2).
   */
  | { kind: "simultaneous"; events: ProposedEvent[] };

/**
 * Carries out an event that another event leads to (destroying a permanent moves it), through the replacement step
 * again: compound events take this rather than calling the primitives, so each part gets its own replacement pass.
 */
export type CarryOut = (state: GameState, proposed: ProposedEvent) => Progress;
