// Players (CR 102).

import type { PlayerId } from "./ids.ts";
import type { ManaPool } from "./mana.ts";

export type PlayerState = {
  id: PlayerId;
  life: number; // CR 119
  manaPool: ManaPool; // CR 106.4
  /** Lands played this turn, for the one-land-per-turn rule (CR 305.2). */
  landsPlayedThisTurn: number;
};
