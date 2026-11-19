// Bookkeeping for the start of a game (CR 103), before the first turn.

import type { PlayerId } from "./ids.ts";

export type Pregame = {
  /** Null until it's decided (CR 103.1). */
  startingPlayer: PlayerId | null;
  /** Mulligans each player has taken so far (CR 103.5). */
  mulligans: Record<PlayerId, number>;
  /** Players who kept their hand. They take no more mulligans. */
  kept: PlayerId[];
  /** This round's declarations so far, in turn order. */
  declarations: { player: PlayerId; choice: "keep" | "mulligan" }[];
  /** After this round's mulligans: who still has cards to put on the bottom, and how many, in turn order. */
  bottom: { player: PlayerId; remaining: number }[];
};
