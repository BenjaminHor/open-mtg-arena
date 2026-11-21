import { describe, expect, it } from "vitest";
import { POOL } from "../src/index.ts";
import { colorsOf, parseManaCost, parseTypeLine, printedCard } from "../src/printed.ts";

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

  it("reads {X} (CR 107.3a)", () => {
    expect(parseManaCost("{X}{R}")).toStrictEqual([{ kind: "x" }, { kind: "colored", color: "R" }]);
  });

  it("rejects symbols that aren't supported yet, and text that isn't a cost", () => {
    for (const bad of ["{W/U}", "{C}", "{G/P}", "2R", "{2}R"]) {
      expect(() => parseManaCost(bad)).toThrow();
    }
  });
});

describe("parseTypeLine", () => {
  it("splits supertypes, card types and subtypes (CR 205.1, 205.2a, 205.4a)", () => {
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

  it("keeps two-word creature types together (CR 205.3b, from the list in CR 205.3m)", () => {
    expect(parseTypeLine("Legendary Creature — Time Lord Human").subtypes).toStrictEqual(["Time Lord", "Human"]);
  });

  it("rejects type lines it doesn't understand, and card types it can't play yet", () => {
    for (const bad of [
      "Tribal Instant — Goblin",
      "Creature — Human // Creature — Werewolf",
      "Wurm",
      "Battle — Siege",
      "Ongoing Scheme",
    ]) {
      expect(() => parseTypeLine(bad)).toThrow();
    }
  });
});

describe("colorsOf", () => {
  it("takes colors from the mana cost and the color indicator, in WUBRG order (CR 105.1, 105.2c, 202.2, 204.2)", () => {
    expect(colorsOf(parseManaCost("{2}{R}{G}{R}"), [])).toStrictEqual(["R", "G"]);
    expect(colorsOf(null, ["U"])).toStrictEqual(["U"]);
    expect(colorsOf(null, [])).toStrictEqual([]);
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
      colorIndicator: [],
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

  it('reads a printed "*", which an ability sets (CR 208.2a), and refuses "1+*", not supported yet', () => {
    expect(card("Nightmare")).toMatchObject({ power: "*", toughness: "*" });
    const nightmare = POOL.cards.find((c) => c.name === "Nightmare");
    if (nightmare === undefined) throw new Error("Nightmare isn't in the pool");
    expect(() => printedCard({ ...nightmare, power: "1+*" })).toThrow();
  });

  it("reads a planeswalker's printed loyalty, which only a planeswalker has (CR 209.1, 306.5a)", () => {
    expect(card("Jace Beleren")).toMatchObject({ supertypes: ["legendary"], types: ["planeswalker"], loyalty: 3 });
    expect(card("Craw Wurm")).not.toHaveProperty("loyalty");
    const jace = POOL.cards.find((c) => c.name === "Jace Beleren");
    if (jace === undefined) throw new Error("Jace Beleren isn't in the pool");
    expect(() => printedCard({ ...jace, loyalty: null })).toThrow(/loyalty/);
    expect(() => printedCard({ ...jace, loyalty: "X" })).toThrow(/loyalty/);
  });

  it("parses every card in the pool", () => {
    for (const c of POOL.cards) expect(() => printedCard(c)).not.toThrow();
  });

  it("derives the same colors Scryfall lists for every pool card", () => {
    // Scryfall's colors also count color-defining abilities (layer 5). A difference here means the card has one,
    // and its definition must say so.
    for (const c of POOL.cards) expect(printedCard(c).colors, c.name).toStrictEqual(c.colors);
  });

  it("rejects a creature without power and toughness, and a noncreature with them (CR 208.1)", () => {
    const bears = POOL.cards.find((c) => c.name === "Grizzly Bears");
    const bolt = POOL.cards.find((c) => c.name === "Lightning Bolt");
    if (bears === undefined || bolt === undefined) throw new Error("test cards missing from the pool");
    expect(() => printedCard({ ...bears, power: null, toughness: null })).toThrow();
    expect(() => printedCard({ ...bolt, power: "1", toughness: "1" })).toThrow();
  });
});
