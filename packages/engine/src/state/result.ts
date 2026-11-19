// Results of engine calls and of whole games.

import type { GameEvent } from "./events.ts";
import type { GameState } from "./game-state.ts";
import type { PlayerId } from "./ids.ts";

/** What every engine call returns. An illegal action changes nothing and returns an error. */
export type EngineResult = { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: EngineError };

export type EngineError = { code: EngineErrorCode; message: string };

export type EngineErrorCode =
  /** The action's `decisionId` isn't the pending decision's. */
  | "staleDecision"
  /** The action came from a player other than the one a non-priority decision is for. */
  | "notYourDecision"
  /** The action came from a player who doesn't have priority while a priority decision is pending (CR 117). */
  | "notYourPriority"
  /** The action isn't one of the legal choices right now. */
  | "illegalAction"
  /** The game is over, so no more actions are accepted. */
  | "gameOver"
  /** The `GameSetup` can't start a game (for example, an unknown card or a duplicate player id). */
  | "invalidSetup";

/** How a game ended. The meta layer (RPG, collection) reads this; it never reads a running game. */
export type GameResult = {
  /** Null for a draw (CR 104.4a). */
  winner: PlayerId | null;
  /** Every player who lost, in the order they lost. */
  losses: Loss[];
  /** The turn number when the game ended. */
  turn: number;
};

export type Loss = { player: PlayerId; reason: LossReason };

export type LossReason =
  | "zeroLife" // CR 704.5a
  | "drewFromEmptyLibrary" // CR 704.5b
  | "conceded"; // CR 104.3a
