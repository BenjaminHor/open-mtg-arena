// The whole game, as plain JSON data (docs/architecture.md, "Game state").
// No classes, Map or Set, functions or undefined values: JSON.parse(JSON.stringify(state)) gives an equal state.
// States are never mutated; each change makes a new state that shares the unchanged parts (D-021).

import type { RngState } from "../rng/xoshiro128.ts";
import type { PendingDecision } from "./decisions.ts";
import type { ObjectId, PlayerId } from "./ids.ts";
import type { GameObject } from "./objects.ts";
import type { PlayerState } from "./players.ts";
import type { GameResult } from "./result.ts";
import type { GameSetup } from "./setup.ts";
import type { Turn } from "./turn.ts";
import type { Zones } from "./zones.ts";

export type GameState = {
  /** The state's schema version, `ENGINE_VERSION` when it was made. Saves from another version are rejected. */
  version: number;
  /** How the game started. With the actions taken since, it reproduces the game exactly. */
  setup: GameSetup;
  /** The only source of randomness (D-024). */
  rng: RngState;
  /** The next number for a new id (`o12`, `c12`, `d12`). Shared by all id kinds, so every id is unique. */
  nextId: number;
  /** The next timestamp (CR 613.7). */
  nextTimestamp: number;

  turn: Turn;
  /**
   * Players in turn order, starting with the starting player (CR 103.1). APNAP order (CR 101.4) and
   * "the next player" always come from this list, cyclically.
   */
  turnOrder: PlayerId[];
  players: Record<PlayerId, PlayerState>;
  objects: Record<ObjectId, GameObject>;
  zones: Zones;

  /** What the game is waiting for. Null only once the game has ended. */
  pending: PendingDecision | null;
  /** Set when the game ends (CR 104). */
  result: GameResult | null;
};
