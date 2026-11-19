// How a game starts. A `GameSetup` plus the actions taken is a complete record of a game:
// replaying them gives the same game (docs/architecture.md, "Match host").

import type { OracleId, PlayerId } from "./ids.ts";
import type { ManaPool } from "./mana.ts";
import type { Counters } from "./objects.ts";
import type { Turn } from "./turn.ts";

export type GameSetup = {
  /** Seeds the game's random number generator. A non-negative safe integer. */
  seed: number;
  /** In seating order, clockwise. Turn order starts with the starting player and goes clockwise (CR 103.1). */
  players: PlayerSetup[];
  opening: Opening;
  /** Extra rules for this game, owned by no card, like emblems (RPG encounters, test setups). */
  ruleModifiers: RuleModifier[];
};

/**
 * - `standard`: the normal start (CR 103). First the starting player is decided (CR 103.1): `firstPlayer` if set,
 *   otherwise a player picked at random from the seed chooses who goes first. Then libraries are shuffled (CR 103.3),
 *   opening hands are drawn and players may mulligan (CR 103.5).
 * - `fixed`: the game begins exactly as described, at the given turn and step, with libraries in the order given and no
 *   mulligans. Used by scenario tests and for saved positions.
 */
export type Opening = { kind: "standard"; firstPlayer: PlayerId | null } | { kind: "fixed"; turn: Turn };

export type PlayerSetup = {
  id: PlayerId;
  /** Normally 20 (CR 103.4). */
  life: number;
  /** The deck. It becomes the library (CR 401.1). With a `fixed` opening, index 0 is the top. */
  library: OracleId[];
  /** Cards that start in hand. Must be empty with a `standard` opening, which draws the hand instead. */
  hand: OracleId[];
  /** Permanents that start on the battlefield, controlled by this player. */
  battlefield: PermanentSetup[];
  graveyard: OracleId[];
  exile: OracleId[];
  manaPool: ManaPool;
};

export type PermanentSetup = {
  oracleId: OracleId;
  tapped: boolean;
  /**
   * True if it hasn't been under its controller's control continuously since their most recent turn began
   * (CR 302.6), so it can't attack or use {T} abilities. The opposite of `CardObject.controlledSinceTurnStart`.
   */
  summoningSick: boolean;
  damage: number;
  counters: Counters;
};

/**
 * A rule modifier is an extra rule for the whole game, owned by no card. It works like an emblem's static
 * ability (CR 114): the engine applies it through the layer system like any other continuous effect (CR 611),
 * from M1-11. Effects that aren't additive will need it to have a timestamp (CR 613.7), as an emblem would.
 */
export type RuleModifier = {
  /** "Creatures this player controls get +N/+N": layer 7c (CR 613.4c). */
  kind: "creaturesGetPT";
  controller: PlayerId;
  power: number;
  toughness: number;
};
