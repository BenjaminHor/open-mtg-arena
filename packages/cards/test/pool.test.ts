import { readdirSync, readFileSync } from "node:fs";
import type { CardDef, TargetSpec } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { CARD_DEFS, cardDatabase, definitionProblems, POOL, slugify } from "../src/index.ts";
import { parsePoolTxt } from "../src/pool-data.ts";

// These tests read only committed files (pool.txt and data/), never the Scryfall downloads, so CI can run them.

const poolEntries = parsePoolTxt(readFileSync(new URL("../pool.txt", import.meta.url), "utf8"));
const poolTxt = poolEntries.map((e) => e.name);

describe("the card pool", () => {
  it("has Oracle data for exactly the cards in pool.txt", () => {
    expect(POOL.cards.map((c) => c.name)).toStrictEqual(poolTxt);
  });

  it("has exactly one rulings file per card, and no others", () => {
    const files = readdirSync(new URL("../data/rulings/", import.meta.url)).filter((f) => f.endsWith(".json"));
    expect(files.sort()).toStrictEqual(POOL.cards.map((c) => `${c.slug}.json`).sort());
  });

  it("has rulings files that belong to their cards", () => {
    for (const card of POOL.cards) {
      const file = JSON.parse(readFileSync(new URL(`../data/rulings/${card.slug}.json`, import.meta.url), "utf8"));
      expect(file.oracleId).toBe(card.oracleId);
    }
  });

  it("shows the pinned printing for every pinned card, and says how each printing was chosen (D-029)", () => {
    for (const card of POOL.cards) expect(["pin", "rule", "oracleCards"]).toContain(card.printingChosenBy);
    for (const { name, pin } of poolEntries) {
      const card = POOL.cards.find((c) => c.name === name);
      if (pin === null) {
        expect(card?.printingChosenBy, name).not.toBe("pin");
        continue;
      }
      // A failure here usually means pool.txt changed without `pnpm cards:extract`.
      expect(card?.printingChosenBy, name).toBe("pin");
      expect(card?.set, name).toBe(pin.set);
      if (pin.collectorNumber !== null) expect(card?.collectorNumber, name).toBe(pin.collectorNumber);
    }
  });

  it("has definitions that match the Oracle data (errata check)", () => {
    expect(definitionProblems(CARD_DEFS, POOL.cards)).toStrictEqual([]);
  });

  it("builds a database entry for every card, keyed by oracle id", () => {
    const db = cardDatabase();
    expect(Object.keys(db).sort()).toStrictEqual(POOL.cards.map((c) => c.oracleId).sort());
  });
});

describe("definitionProblems", () => {
  const bolt = POOL.cards.find((c) => c.name === "Lightning Bolt");
  const whelp = POOL.cards.find((c) => c.name === "Furnace Whelp");
  if (bolt === undefined || whelp === undefined) throw new Error("test cards missing from the pool");

  it("reports a definition written against old Oracle text", () => {
    const outdated = { name: "Lightning Bolt", oracle: "Lightning Bolt deals 3 damage to target creature or player." };
    const [problem, ...rest] = definitionProblems([outdated], [bolt]);
    expect(rest).toStrictEqual([]);
    expect(problem).toContain("Lightning Bolt: Oracle text changed");
  });

  it("reports a missing keyword", () => {
    const def = { name: "Furnace Whelp", oracle: whelp.oracleText };
    expect(definitionProblems([def], [whelp])).toStrictEqual(['Furnace Whelp: keywords [], but Oracle has ["flying"]']);
  });

  it("reports target shapes the engine can't use: a minimum above the maximum, a division it can't make (CR 601.2d)", () => {
    const ignite = POOL.cards.find((c) => c.name === "Ignite Disorder");
    if (ignite === undefined) throw new Error("Ignite Disorder missing from the pool");
    const creatures = (): TargetSpec => ({ kind: "permanent", filter: { types: ["creature"] } });
    const def = (count: { min: number; max: number }, to: { target: number } | "self", amount = 3): CardDef => ({
      name: "Ignite Disorder",
      oracle: ignite.oracleText,
      spell: {
        targets: [{ kind: "permanent", filter: { types: ["creature"] }, count }],
        effects: [{ op: "dealDamage", amount, from: "self", to, divided: "asYouChoose" }],
      },
    });
    expect(definitionProblems([def({ min: 1, max: 3 }, { target: 0 })], [ignite])).toStrictEqual([]);
    expect(definitionProblems([def({ min: 3, max: 1 }, { target: 0 })], [ignite])).toStrictEqual([
      "Ignite Disorder: target 0 has a minimum above its maximum",
    ]);
    expect(definitionProblems([def({ min: 1, max: 3 }, "self")], [ignite])).toStrictEqual([
      'Ignite Disorder: divided damage must divide among an instance of "target"',
    ]);
    const twoInstances: CardDef = {
      ...def({ min: 1, max: 3 }, { target: 0 }),
      spell: {
        targets: [creatures(), creatures()],
        effects: [],
        costIncrease: { perTargetBeyondFirst: [{ kind: "generic", amount: 1 }] },
      },
    };
    expect(definitionProblems([twoInstances], [ignite])).toStrictEqual([
      'Ignite Disorder: a cost increase per target is only read for a spell with one instance of "target"',
    ]);
    expect(definitionProblems([def({ min: 4, max: 4 }, { target: 0 })], [ignite])).toStrictEqual([
      "Ignite Disorder: divided damage of 3 can't give each of at least 4 targets 1",
    ]);
  });

  it("reports a subject of the wrong kind, which would quietly do nothing", () => {
    const offering = POOL.cards.find((c) => c.name === "Solemn Offering");
    if (offering === undefined) throw new Error("Solemn Offering missing from the pool");
    const def = (
      effects: CardDef["spell"] extends infer S ? (S extends { effects: infer E } ? E : never) : never,
    ): CardDef => ({
      name: "Solemn Offering",
      oracle: offering.oracleText,
      spell: { targets: [{ kind: "permanent", filter: { types: ["artifact", "enchantment"] } }], effects },
    });
    expect(definitionProblems([def([{ op: "destroy", of: "you" }])], [offering])).toStrictEqual([
      "Solemn Offering: destroy acts on objects, not players",
    ]);
    expect(definitionProblems([def([{ op: "gainLife", who: { target: 0 }, amount: 4 }])], [offering])).toStrictEqual([
      "Solemn Offering: gainLife is for players, not objects",
    ]);
  });

  it("reports cards without definitions and definitions without cards", () => {
    expect(definitionProblems([{ name: "Black Lotus", oracle: "" }], [bolt])).toStrictEqual([
      "Black Lotus: has a definition but isn't in pool.txt / data/pool.json",
      "Lightning Bolt: is in the pool but has no definition",
    ]);
  });
});

describe("slugify", () => {
  it("makes file names from card names", () => {
    expect(slugify("Lightning Bolt")).toBe("lightning-bolt");
    expect(slugify("Gaea's Cradle")).toBe("gaeas-cradle");
    expect(slugify("Fire // Ice")).toBe("fire-ice");
    expect(slugify("Æther Vial")).toBe("aether-vial");
    expect(slugify("Lim-Dûl's Vault")).toBe("lim-duls-vault");
  });
});

describe("parsePoolTxt", () => {
  it("reads names, optional pins, and skips comments", () => {
    expect(parsePoolTxt("# comment\n\nShock\nLightning Bolt [m10]\nForest [m10 246]\n")).toStrictEqual([
      { name: "Forest", pin: { set: "m10", collectorNumber: "246" } },
      { name: "Lightning Bolt", pin: { set: "m10", collectorNumber: null } },
      { name: "Shock", pin: null },
    ]);
  });

  it("rejects a duplicate card and a pin it can't read", () => {
    expect(() => parsePoolTxt("Shock\nShock [m19]\n")).toThrow(/twice/);
    expect(() => parsePoolTxt("Shock [M19\n")).toThrow(/can't read the pin/);
  });
});
