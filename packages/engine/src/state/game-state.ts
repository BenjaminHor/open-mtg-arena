// The whole game, as plain JSON data (docs/architecture.md, "Game state").
// No classes, Map or Set, functions or undefined values: JSON.parse(JSON.stringify(state)) gives an equal state.
// States are never mutated; each change makes a new state that shares the unchanged parts (D-021).

import type { RngState } from "../rng/xoshiro128.ts";
import type { Casting } from "./casting.ts";
import type { Combat } from "./combat.ts";
import type { PendingDecision } from "./decisions.ts";
import type { ContinuousEffect } from "./effects.ts";
import type { ObjectId, PlayerId } from "./ids.ts";
import type { CardObject, GameObject } from "./objects.ts";
import type { PlayerState } from "./players.ts";
import type { Pregame } from "./pregame.ts";
import type { GameResult } from "./result.ts";
import type { GameSetup } from "./setup.ts";
import type { ActivationCount, DelayedTrigger, PendingTrigger } from "./triggers.ts";
import type { Turn } from "./turn.ts";
import type { WorkItem } from "./work.ts";
import type { Zones } from "./zones.ts";

export type GameState = {
  /** The state's schema version, `ENGINE_VERSION` when it was made. Saves from another version are rejected. */
  version: number;
  /** How the game started. With the actions taken since, it reproduces the game exactly. */
  setup: GameSetup;
  /** The only source of randomness (D-024). */
  rng: RngState;
  /** The next number for a new object or decision id (`o12`, `d12`). Shared by both, so every id is unique. */
  nextId: number;
  /**
   * The next number for a new card id. The setup's cards are `c1` to `cN` (D-045); a card that leaves a hand or a
   * library for a public zone gets the next one (D-054), so no one can follow it through a hidden zone.
   */
  nextCardId: number;
  /** The next timestamp (CR 613.7). */
  nextTimestamp: number;

  /** Null before the first turn begins (while the starting player is chosen and players mulligan). */
  turn: Turn | null;
  /**
   * Players in turn order, starting with the starting player (CR 103.1). APNAP order (CR 101.4) and
   * "the next player" always come from this list, cyclically.
   */
  turnOrder: PlayerId[];
  players: Record<PlayerId, PlayerState>;
  objects: Record<ObjectId, GameObject>;
  zones: Zones;
  /** Continuous effects from resolved spells and abilities (CR 611.2), oldest first. */
  effects: ContinuousEffect[];
  /**
   * Creatures dealt damage by a source with deathtouch since state-based actions were last checked (CR 704.5h,
   * 702.2b). Every check clears it.
   */
  dealtDeathtouchDamage: ObjectId[];
  /**
   * Triggered abilities that triggered and wait to be put on the stack the next time a player would receive priority
   * (CR 603.3), in the order they triggered. Empty whenever a player has priority.
   */
  pendingTriggers: PendingTrigger[];
  /**
   * Last known information (CR 608.2h): permanents as they last existed on the battlefield, by their old id, for
   * abilities and effects that need an object that has left (a trigger's "intervening if", CR 603.4). Kept while
   * something on the stack or waiting to go on it might need them; emptied when a player gets priority with both empty.
   */
  lastKnown: Record<ObjectId, CardObject>;
  /** Delayed triggered abilities waiting for their event (CR 603.7), in the order they were made. */
  delayedTriggers: DelayedTrigger[];
  /** Activated abilities' activations this turn (D-078), emptied as each turn begins. */
  activationsThisTurn: ActivationCount[];

  /**
   * The start of a `standard` game (CR 103.1, 103.3–103.5; extra steps some formats take, later: CR 103.2), until the
   * first turn begins. Null afterwards.
   */
  pregame: Pregame | null;

  /**
   * How many players have passed priority in succession without taking an action (CR 117.4). When it reaches the
   * number of players, the top of the stack resolves, or with an empty stack the step ends (CR 500.2). A new step
   * starts it at 0.
   */
  passesInSuccession: number;
  /** Attackers and blockers during the combat phase (CR 506), or null outside it. */
  combat: Combat | null;
  /** A spell part way through being cast (CR 601.2), or null. */
  casting: Casting | null;
  /**
   * What the spell or ability resolving now has done "this way" (CR 608.2c), for its later effects: the cards a
   * search found, the cards it exiled. Null except while an object resolves; cleared as its resolution ends.
   */
  resolution: Resolution | null;

  /** Work waiting to happen, next first (docs/architecture.md, D-032). It waits while a decision is pending. */
  work: WorkItem[];

  /** What the game is waiting for. Null only once the game has ended. */
  pending: PendingDecision | null;
  /** Set when the game ends (CR 104). */
  result: GameResult | null;
};

/** See `GameState.resolution`. */
export type Resolution = { object: ObjectId; found: ObjectId[]; exiled: ObjectId[]; sacrificed: Sacrificed[] };

/**
 * A permanent sacrificed this way (CR 608.2c), with its power as it last existed on the battlefield (CR 608.2h), for
 * "loses life equal to the sacrificed creature's power". Null for a permanent with no power.
 */
export type Sacrificed = { object: ObjectId; power: number | null };
