// Mana (CR 106).

import type { Color } from "../cards/types.ts";

/** The five colors of mana plus colorless (CR 106.1a–b). */
export type ManaType = "W" | "U" | "B" | "R" | "G" | "C";

/** Unspent mana a player has, by type (CR 106.4). Every type is always present, with 0 when empty. */
export type ManaPool = Record<ManaType, number>;

export const MANA_TYPES: readonly ManaType[] = ["W", "U", "B", "R", "G", "C"];

/** The five colors, which "one mana of any color" can be: never colorless (CR 105.1, 105.4). */
export const COLORS: readonly Color[] = ["W", "U", "B", "R", "G"];

export function emptyManaPool(): ManaPool {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}
