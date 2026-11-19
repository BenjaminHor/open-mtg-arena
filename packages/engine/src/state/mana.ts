// Mana (CR 106).

/** The five colors of mana plus colorless (CR 106.1a–b). */
export type ManaType = "W" | "U" | "B" | "R" | "G" | "C";

/** Unspent mana a player has, by type (CR 106.4). Every type is always present, with 0 when empty. */
export type ManaPool = Record<ManaType, number>;

export const MANA_TYPES: readonly ManaType[] = ["W", "U", "B", "R", "G", "C"];

export function emptyManaPool(): ManaPool {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}
