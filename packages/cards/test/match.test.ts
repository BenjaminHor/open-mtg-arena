import { describe, expect, it } from "vitest";
import { choosePrinting, matchPoolCards } from "../scripts/match.ts";
import type { ScryfallCard } from "../scripts/scryfall.ts";

function card(name: string, fields: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    name,
    oracle_id: `${name}-id`,
    layout: "normal",
    cmc: 0,
    type_line: "Creature — Elf",
    keywords: [],
    set: "tst",
    set_type: "expansion",
    collector_number: "1",
    released_at: "2020-01-01",
    lang: "en",
    games: ["paper", "mtgo"],
    digital: false,
    promo: false,
    variation: false,
    scryfall_uri: "https://scryfall.com/",
    ...fields,
  };
}

describe("matchPoolCards", () => {
  it("ignores a token that shares a card's name", () => {
    const elves = card("Llanowar Elves");
    expect(matchPoolCards(["Llanowar Elves"], [card("Llanowar Elves", { layout: "token" }), elves])).toStrictEqual([
      elves,
    ]);
  });

  it("returns the cards in the order of the names", () => {
    const a = card("Alpha");
    const b = card("Beta");
    expect(matchPoolCards(["Beta", "Alpha"], [a, b])).toStrictEqual([b, a]);
  });

  it("fails on a missing name and on a name with two matches, listing both", () => {
    const twice = [card("Twice", { set: "a" }), card("Twice", { set: "b", layout: "saga" })];
    expect(() => matchPoolCards(["Missing", "Twice"], twice)).toThrow(/"Missing": 0 matches[\s\S]*"Twice": 2 matches/);
  });
});

describe("choosePrinting (D-029)", () => {
  const ASOF = "2026-11-19";
  const oracle = card("Bolt", { set: "msc", set_type: "commander" });
  const m10 = card("Bolt", { set: "m10", collector_number: "146", released_at: "2009-07-17", set_type: "core" });
  const m11 = card("Bolt", { set: "m11", collector_number: "149", released_at: "2010-07-16", set_type: "core" });
  const promo = card("Bolt", { set: "pm11", released_at: "2010-08-01", promo: true });
  const digital = card("Bolt", { set: "ana", released_at: "2021-01-01", digital: true, games: ["arena"] });
  const crossover = card("Bolt", { set: "msc", released_at: "2026-01-01", set_type: "commander" });
  const all = [m10, m11, promo, digital, crossover];

  it("uses the pinned printing", () => {
    expect(
      choosePrinting({ name: "Bolt", pin: { set: "m10", collectorNumber: null } }, oracle, all, ASOF),
    ).toStrictEqual({
      printing: m10,
      chosenBy: "pin",
    });
  });

  it("uses the collector number when the set has several printings", () => {
    const m10b = { ...m10, collector_number: "300" };
    const pin = { set: "m10", collectorNumber: "300" };
    expect(choosePrinting({ name: "Bolt", pin }, oracle, [...all, m10b], ASOF).printing).toBe(m10b);
    expect(() =>
      choosePrinting({ name: "Bolt", pin: { set: "m10", collectorNumber: null } }, oracle, [m10, m10b], ASOF),
    ).toThrow(/\[m10 146\], \[m10 300\]/);
  });

  it("fails on a pin that names no printing", () => {
    expect(() =>
      choosePrinting({ name: "Bolt", pin: { set: "lea", collectorNumber: null } }, oracle, all, ASOF),
    ).toThrow(/Printings in that set: none/);
  });

  it("otherwise picks the newest regular paper printing, skipping promos, digital, crossover and unreleased sets", () => {
    const universesBeyond = card("Bolt", { set: "spm", released_at: "2025-09-26", promo_types: ["universesbeyond"] });
    const unreleased = card("Bolt", { set: "fut", released_at: "2027-04-09", set_type: "core" });
    const printings = [...all, universesBeyond, unreleased];
    expect(choosePrinting({ name: "Bolt", pin: null }, oracle, printings, ASOF)).toStrictEqual({
      printing: m11,
      chosenBy: "rule",
    });
  });

  it("leaves out each kind of printing the rule excludes", () => {
    const regular = card("Bolt", { set: "old", released_at: "2001-01-01" });
    const excluded: [string, Partial<ScryfallCard>][] = [
      ["not English", { lang: "ja" }],
      ["a variant", { variation: true }],
      ["paper-less (MTGO only)", { games: ["mtgo"] }],
      ["digital, even if listed for paper", { digital: true, games: ["paper", "arena"] }],
      ["a promo", { promo: true }],
      ["Universes Beyond", { promo_types: ["universesbeyond"] }],
      ["not a core set or expansion", { set_type: "masters" }],
      ["released after the bulk file", { released_at: "2026-11-20" }],
    ];
    for (const [why, fields] of excluded) {
      const newer = card("Bolt", { set: "new", released_at: "2026-11-19", ...fields });
      expect(choosePrinting({ name: "Bolt", pin: null }, oracle, [regular, newer], ASOF).printing, why).toBe(regular);
    }
  });

  it("keeps a printing released on the bulk file's date", () => {
    const today = card("Bolt", { set: "new", released_at: ASOF });
    expect(choosePrinting({ name: "Bolt", pin: null }, oracle, [m10, today], ASOF).printing).toBe(today);
  });

  it("breaks a same-day tie by collector number, compared as numbers", () => {
    const n100 = card("Bolt", { set: "fra", collector_number: "100", released_at: "2026-02-01" });
    const n99 = card("Bolt", { set: "fra", collector_number: "99", released_at: "2026-02-01" });
    expect(choosePrinting({ name: "Bolt", pin: null }, oracle, [n100, n99], ASOF).printing).toBe(n99);
    expect(choosePrinting({ name: "Bolt", pin: null }, oracle, [n99, n100], ASOF).printing).toBe(n99);
  });

  it("lets a pin choose a printing the rule would skip", () => {
    const pin = { set: "pm11", collectorNumber: null };
    expect(choosePrinting({ name: "Bolt", pin }, oracle, all, ASOF)).toStrictEqual({
      printing: promo,
      chosenBy: "pin",
    });
  });

  it("falls back to Oracle Cards' pick when there's no regular printing", () => {
    expect(choosePrinting({ name: "Bolt", pin: null }, oracle, [digital, crossover], ASOF)).toStrictEqual({
      printing: oracle,
      chosenBy: "oracleCards",
    });
  });
});
