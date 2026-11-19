// How a game starts. A `GameSetup` plus the actions taken is a complete record of a game:
// replaying them gives the same game (docs/architecture.md, "Match host").

import type { OracleId, PlayerId } from "./ids.ts";
import type { ManaPool } from "./mana.ts";
import type { Counters } from "./objects.ts";
import type { Turn } from "./turn.ts";

export type GameSetup = {
  /** Seeds the game's random number generator. A non-negative safe integer. */
  seed: number;
  /** In turn order. */
  players: PlayerSetup[];
  opening: Opening;
  /** Extra rules for this game, owned by no card, like emblems (RPG encounters, test setups). */
  ruleModifiers: RuleModifier[];
};

/**
 * - `standard`: the normal start (CR 103). Libraries are shuffled, the starting player is chosen (at random from
 *   the seed when `firstPlayer` is null, CR 103.1), opening hands are drawn and players may mulligan (CR 103.5).
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
  /** True if it came under its controller's control this turn (CR 302.6), so it can't attack or use {T} yet. */
  summoningSick: boolean;
  damage: number;
  counters: Counters;
};

/**
 * A rule modifier is a continuous effect with no source card (CR 611). The engine applies it through the
 * layer system like any other continuous effect, from M1-11.
 */
export type RuleModifier = {
  /** "Creatures this player controls get +N/+N": layer 7c (CR 613.4c). */
  kind: "creaturesGetPT";
  controller: PlayerId;
  power: number;
  toughness: number;
};
