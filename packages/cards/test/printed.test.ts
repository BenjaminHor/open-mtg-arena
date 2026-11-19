import { describe, expect, it } from "vitest";
import { POOL } from "../src/index.ts";
import { parseManaCost, parseTypeLine, printedCard } from "../src/printed.ts";

describe("parseManaCost", () => {
  it("reads generic and colored symbols in order (CR 107.4)", () => {
    expect(parseManaCost("{2}{R}{R}")).toStrictEqual([
      { kind: "generic", amount: 2 },
      { kind: "colored", color: "R" },
      { kind: "colored", color: "R" },
    ]);
    expect(parseManaCost("{G}")).toStrictEqual([{ kind: "colored", color: "G" }]);
    expect(parseManaCost("{0}")).toStrictEqual([{ kind: "generic", amount: 0 }]);
  });

  it("rejects symbols that aren't supported yet, and text that isn't a cost", () => {
    for (const bad of ["{X}{R}", "{W/U}", "{C}", "{G/P}", "2R", "{2}R"]) {
      expect(() => parseManaCost(bad)).toThrow();
    }
  });
});

describe("parseTypeLine", () => {
  it("splits supertypes, card types and subtypes (CR 205)", () => {
    expect(parseTypeLine("Basic Land — Mountain")).toStrictEqual({
      supertypes: ["basic"],
      types: ["land"],
      subtypes: ["Mountain"],
    });
    expect(parseTypeLine("Creature — Elf Druid")).toStrictEqual({
      supertypes: [],
      types: ["creature"],
      subtypes: ["Elf", "Druid"],
    });
    expect(parseTypeLine("Instant")).toStrictEqual({ supertypes: [], types: ["instant"], subtypes: [] });
  });

  it("rejects type lines it doesn't understand", () => {
    for (const bad of ["Tribal Instant — Goblin", "Creature — Human // Creature — Werewolf", "Wurm"]) {
      expect(() => parseTypeLine(bad)).toThrow();
    }
  });
});

describe("printedCard", () => {
  const card = (name: string) => {
    const found = POOL.cards.find((c) => c.name === name);
    if (found === undefined) throw new Error(`${name} isn't in the pool`);
    return printedCard(found);
  };

  it("gives a land no mana cost, which differs from {0} (CR 202.1b)", () => {
    expect(card("Mountain")).toStrictEqual({
      name: "Mountain",
      manaCost: null,
      colors: [],
      supertypes: ["basic"],
      types: ["land"],
      subtypes: ["Mountain"],
      power: null,
      toughness: null,
    });
  });

  it("reads a creature's power and toughness", () => {
    expect(card("Craw Wurm")).toMatchObject({ power: 6, toughness: 4, colors: ["G"], subtypes: ["Wurm"] });
  });

  it("parses every card in the pool", () => {
    for (const c of POOL.cards) expect(() => printedCard(c)).not.toThrow();
  });
});
