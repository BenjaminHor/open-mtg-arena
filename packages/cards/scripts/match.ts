// Matching pool.txt names to Scryfall's Oracle Cards, kept apart from the file handling so it can be tested.

import type { ScryfallCard } from "./scryfall.ts";

// Oracle Cards also has entries that aren't Magic cards you can put in a deck. Some share a name with a real card
// (Llanowar Elves has a token), so they're left out before matching names.
const NOT_CARDS = new Set(["token", "double_faced_token", "emblem", "art_series", "vanguard", "planar", "scheme"]);

/**
 * The one card for each name. Throws, listing every problem, if a name matches no card or several. Layouts the engine
 * doesn't support yet are rejected later, by `toPoolCard`, so the error names the real card.
 */
export function matchPoolCards(names: readonly string[], cards: Iterable<ScryfallCard>): ScryfallCard[] {
  const matches = new Map<string, ScryfallCard[]>(names.map((n) => [n, []]));
  for (const card of cards) {
    if (!NOT_CARDS.has(card.layout)) matches.get(card.name)?.push(card);
  }
  const problems = [...matches]
    .filter(([, found]) => found.length !== 1)
    .map(
      ([name, found]) =>
        `"${name}": ${found.length} matches${found.map((c) => `\n  ${c.layout} ${c.set} ${c.oracle_id}`).join("")}`,
    );
  if (problems.length > 0) {
    throw new Error(`Every pool.txt name must match exactly one card in Oracle Cards.\n${problems.join("\n")}`);
  }
  return names.map((name) => (matches.get(name) ?? [])[0] as ScryfallCard);
}
