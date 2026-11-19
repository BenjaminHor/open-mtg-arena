// Matching pool.txt names to Scryfall's Oracle Cards, kept apart from the file handling so it can be tested.

import { compareNames as compareStrings, type PoolEntry } from "../src/pool-data.ts";
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

export type PrintingChoice = "pin" | "rule" | "oracleCards";

/** Set types of regular releases. Others are commander, masters, crossover and digital products, and so on. */
const REGULAR_SET_TYPES = new Set(["core", "expansion"]);

/**
 * The printing whose art and artist a pool card shows (D-029): the pinned one, else the newest regular printing
 * (paper, not digital-only, not a promo, variant or Universes Beyond crossover, from a core set or expansion, already
 * released on `asOf`), else Oracle Cards' own pick. `printings` are the card's printings from Default Cards, in any order.
 * `asOf` is the bulk file's date (YYYY-MM-DD), not today's, so the same download always gives the same choice.
 */
export function choosePrinting(
  entry: PoolEntry,
  oracleCard: ScryfallCard,
  printings: readonly ScryfallCard[],
  asOf: string,
): { printing: ScryfallCard; chosenBy: PrintingChoice } {
  const { pin } = entry;
  if (pin !== null) {
    // Pins name English printings, like the rule, so a set with foreign-language printings can't pin one by accident.
    const inSet = printings.filter((p) => p.set === pin.set && p.lang === "en");
    const found =
      pin.collectorNumber === null ? inSet : inSet.filter((p) => p.collector_number === pin.collectorNumber);
    if (found.length === 1 && found[0] !== undefined) return { printing: found[0], chosenBy: "pin" };
    const options = inSet.map((p) => `[${p.set} ${p.collector_number}]`).join(", ") || "none";
    throw new Error(`${entry.name}: the pin doesn't name exactly one printing. Printings in that set: ${options}`);
  }
  const regular = printings
    .filter(
      (p) =>
        p.lang === "en" &&
        p.games.includes("paper") &&
        !p.digital &&
        !p.promo &&
        !p.variation &&
        !(p.promo_types ?? []).includes("universesbeyond") &&
        p.released_at <= asOf &&
        REGULAR_SET_TYPES.has(p.set_type),
    )
    .sort(
      (a, b) =>
        compareStrings(b.released_at, a.released_at) ||
        a.collector_number.localeCompare(b.collector_number, "en", { numeric: true }) ||
        // Final plain comparisons make the order total, so the file's order never matters.
        compareStrings(a.set, b.set) ||
        compareStrings(a.collector_number, b.collector_number),
    );
  const newest = regular[0];
  return newest !== undefined
    ? { printing: newest, chosenBy: "rule" }
    : { printing: oracleCard, chosenBy: "oracleCards" };
}
