// Players (CR 102.1).

import type { PlayerId } from "./ids.ts";
import type { ManaPool } from "./mana.ts";

export type PlayerState = {
  id: PlayerId;
  life: number; // CR 119
  manaPool: ManaPool; // CR 106.4
  /** Lands played this turn, for the one-land-per-turn rule (CR 305.2). */
  landsPlayedThisTurn: number;
  /**
   * Whether the player tried to draw from an empty library since state-based actions were last checked. That player
   * loses when they're next checked (CR 121.4, 704.5b), which arrives in M1-12; the check then clears this.
   */
  attemptedDrawFromEmptyLibrary: boolean;
};
