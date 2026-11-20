import { readdirSync, readFileSync } from "node:fs";
import type { CardDef, Effect, TargetSpec, TriggeredAbilityDef } from "@mtg/engine";
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

  it('reports "that player" and "sacrifice it" where nothing supplies them', () => {
    const draw: Effect = { op: "draw", who: "triggeringPlayer", amount: 1 };
    const enters: TriggeredAbilityDef = { when: { kind: "selfEnters" }, targets: [], effects: [draw] };
    const spell: CardDef = {
      name: "Lightning Bolt",
      oracle: bolt.oracleText,
      spell: { targets: [], effects: [draw, { op: "sacrificeSource" }] },
    };
    const trigger: CardDef = {
      name: "Furnace Whelp",
      oracle: whelp.oracleText,
      keywords: ["flying"],
      triggers: [enters],
    };
    expect(definitionProblems([spell, trigger], [bolt, whelp])).toStrictEqual([
      'Lightning Bolt: a spell has no source to sacrifice ("sacrifice it" is for an ability)',
      'Lightning Bolt: "that player" is only for a triggered ability',
      'Furnace Whelp trigger 1: its event has no "that player"',
    ]);
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
    expect(definitionProblems([def([{ op: "exile", of: "eachPlayer" }])], [offering])).toStrictEqual([
      "Solemn Offering: exile acts on objects, not players",
    ]);
    expect(definitionProblems([def([{ op: "mill", who: "self", amount: 2 }])], [offering])).toStrictEqual([
      "Solemn Offering: mill is for players, not objects",
    ]);
  });

  it("reports a filtered or caster-chosen discard from a hand that wasn't revealed first (D-062)", () => {
    const duress = POOL.cards.find((c) => c.name === "Duress");
    if (duress === undefined) throw new Error("Duress missing from the pool");
    const discard: Effect = {
      op: "discard",
      who: { target: 0 },
      amount: 1,
      chosenBy: "you",
      filter: { notTypes: ["creature", "land"] },
    };
    const def = (effects: CardDef["spell"] extends infer S ? (S extends { effects: infer E } ? E : never) : never) => ({
      name: "Duress",
      oracle: duress.oracleText,
      spell: { targets: [{ kind: "opponent" as const }], effects },
    });
    expect(definitionProblems([def([discard])], [duress])).toStrictEqual([
      'Duress: a discard with a filter or chosen by "you" must follow revealing that hand',
    ]);
    expect(definitionProblems([def([{ op: "revealHand", who: { target: 0 } }, discard])], [duress])).toStrictEqual([]);
  });

  it("reports 'found' with no search before it, a same-name search with no exile before it, and each player searching", () => {
    const tutor = POOL.cards.find((c) => c.name === "Diabolic Tutor");
    if (tutor === undefined) throw new Error("Diabolic Tutor missing from the pool");
    const def = (effects: Effect[]): CardDef => ({
      name: "Diabolic Tutor",
      oracle: tutor.oracleText,
      spell: { targets: [], effects },
    });
    expect(definitionProblems([def([{ op: "put", of: "found", into: "hand" }])], [tutor])).toStrictEqual([
      "Diabolic Tutor: put names the cards found, but no search comes before it",
    ]);
    expect(
      definitionProblems(
        [def([{ op: "search", library: "you", count: "anyNumber", sameNameAsExiled: true }])],
        [tutor],
      ),
    ).toStrictEqual(["Diabolic Tutor: a search for the cards exiled this way must follow exiling them"]);
    expect(definitionProblems([def([{ op: "search", library: "eachPlayer", count: "one" }])], [tutor])).toStrictEqual([
      "Diabolic Tutor: search names one player, not each player",
    ]);
  });

  it("reports a player effect on 'each' permanent, a counted divided amount, and damage from a player", () => {
    const quake = POOL.cards.find((c) => c.name === "Earthquake");
    if (quake === undefined) throw new Error("Earthquake missing from the pool");
    const def = (effects: Effect[], targets: TargetSpec[] = []): CardDef => ({
      name: "Earthquake",
      oracle: quake.oracleText,
      spell: { targets, effects },
    });
    const each = { each: { types: ["creature" as const] } };
    expect(definitionProblems([def([{ op: "gainLife", who: each, amount: 1 }])], [quake])).toStrictEqual([
      "Earthquake: gainLife is for players, not objects",
    ]);
    const counted = { count: { types: ["land" as const] } };
    const divided: Effect = {
      op: "dealDamage",
      amount: counted,
      from: "self",
      to: { target: 0 },
      divided: "asYouChoose",
    };
    expect(definitionProblems([def([divided], [{ kind: "anyTarget" }])], [quake])).toContain(
      "Earthquake: divided damage can't be a counted amount",
    );
    expect(
      definitionProblems([def([{ op: "dealDamage", amount: 1, from: "you", to: "eachPlayer" }])], [quake]),
    ).toStrictEqual(["Earthquake: damage comes from one object"]);
  });

  it("reports xPaidWith on a spell whose mana cost has no {X}", () => {
    const bolt = POOL.cards.find((c) => c.name === "Lightning Bolt");
    if (bolt === undefined) throw new Error("Lightning Bolt missing from the pool");
    const def: CardDef = {
      name: "Lightning Bolt",
      oracle: bolt.oracleText,
      spell: {
        targets: [{ kind: "anyTarget" }],
        effects: [{ op: "dealDamage", amount: 3, from: "self", to: { target: 0 } }],
        xPaidWith: "R",
      },
    };
    expect(definitionProblems([def], [bolt])).toStrictEqual([
      "Lightning Bolt: xPaidWith restricts paying X, but the mana cost has no {X}",
    ]);
  });

  it("reports mana of any color outside a mana ability with a {T} cost (D-068)", () => {
    const harvest = POOL.cards.find((c) => c.name === "Bountiful Harvest");
    if (harvest === undefined) throw new Error("Bountiful Harvest missing from the pool");
    const def: CardDef = {
      name: "Bountiful Harvest",
      oracle: harvest.oracleText,
      spell: { targets: [], effects: [{ op: "addMana", mana: "anyColor", amount: 1 }] },
    };
    expect(definitionProblems([def], [harvest])).toContain(
      "Bountiful Harvest: mana of any color is only for a mana ability",
    );
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
