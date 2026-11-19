// Zones (CR 400). Each zone is an ordered list of object ids.

import type { ObjectId, PlayerId } from "./ids.ts";

/** The zones the engine supports (CR 400.1). The ante zone is not supported. */
export type ZoneName = "library" | "hand" | "graveyard" | "battlefield" | "stack" | "exile" | "command";

/** Zones each player has their own of (CR 400.1). A card always goes to its owner's (CR 400.3). */
export type PlayerZoneName = "library" | "hand" | "graveyard";

/** Zones shared by all players (CR 400.1). */
export type SharedZoneName = "battlefield" | "stack" | "exile" | "command";

/** A specific zone: a player's library, hand or graveyard, or one of the shared zones. */
export type ZoneRef = { zone: PlayerZoneName; player: PlayerId } | { zone: SharedZoneName };

/**
 * Order conventions:
 * - `library[0]` is the top card, so drawing takes from the front.
 * - The **last** entry of `stack` is the top: objects are pushed on top (CR 405.2) and resolve from the end.
 * - The **last** entry of `graveyard` is the top: cards are put on top (CR 404.1) and the order is kept (CR 404.2).
 * - `hand`, `battlefield`, `exile` and `command` have no rules meaning to their order; it's kept for stable display.
 */
export type Zones = {
  players: Record<PlayerId, PlayerZones>;
  battlefield: ObjectId[];
  stack: ObjectId[];
  exile: ObjectId[];
  command: ObjectId[];
};

export type PlayerZones = Record<PlayerZoneName, ObjectId[]>;
