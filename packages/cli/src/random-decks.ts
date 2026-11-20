// Random decks from the pool, for the fuzzer's odd seeds and the golden games' candidates (`pnpm golden:cover`).

import { type DeckList, POOL } from "@mtg/cards";
import { nextRandom } from "./seeded-random.ts";

/**
 * Two random 40-card decks from the pool: 23 random nonland cards and 17 basic lands, each of a random color among the
 * cards' colors (Mountains and Forests for a deck with no colored card). A deck can still draw lands that don't match
 * its spells, which tests that too.
 */
export function randomDecks(seed: number): DeckList[] {
  // Not `seed` itself, which the agent's choices start from: the two would begin with the same numbers.
  let rng = (seed ^ 0x9e3779b9) >>> 0;
  const nextRandomValue = (): number => {
    const r = nextRandom(rng);
    rng = r.seed;
    return r.value;
  };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(nextRandomValue() * items.length)] as T;
  const nonlands = POOL.cards.filter((c) => !c.typeLine.includes("Land")).map((c) => c.name);
  return [1, 2].map((n) => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 23; i++) {
      const card = pick(nonlands);
      counts.set(card, (counts.get(card) ?? 0) + 1);
    }
    const colors = [...counts.keys()].flatMap((name) => POOL.cards.find((c) => c.name === name)?.colors ?? []);
    const lands = [...new Set(colors)]
      .flatMap((color) => BASIC_LAND[color] ?? [])
      .filter((land) => POOL.cards.some((c) => c.name === land));
    for (let i = 0; i < 17; i++) {
      const land = pick(lands.length > 0 ? lands : ["Mountain", "Forest"]);
      counts.set(land, (counts.get(land) ?? 0) + 1);
    }
    const cards = [...counts].filter(([, count]) => count > 0).map(([card, count]) => ({ card, count }));
    return { name: `random-${seed}-${n}`, cards };
  });
}

/** The basic land that makes each color's mana (CR 305.6). */
const BASIC_LAND: Record<string, string> = { W: "Plains", U: "Island", B: "Swamp", R: "Mountain", G: "Forest" };
