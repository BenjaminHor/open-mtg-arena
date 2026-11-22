import { readdirSync, readFileSync } from "node:fs";
import type { AbilityDef, CardDef, Effect, TargetSpec, TokenDef, TriggeredAbilityDef } from "@mtg/engine";
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

  it("reports cards returned from those found, or revealed by the count shuffled in, with nothing before to set them", () => {
    const spell = (effects: Effect[]): CardDef => ({
      name: "Lightning Bolt",
      oracle: bolt.oracleText,
      spell: { targets: [], effects },
    });
    const returned: Effect = { op: "returnAllToBattlefield", from: "found", filter: {}, under: "owners" };
    const revealed: Effect = { op: "revealTop", who: "eachPlayer", count: "shuffledIn" };
    expect(definitionProblems([spell([returned])], [bolt])).toContain(
      'Lightning Bolt: returnAllToBattlefield from "found", but no search, reveal or choice comes before it',
    );
    expect(definitionProblems([spell([revealed])], [bolt])).toContain(
      "Lightning Bolt: revealTop counts the cards shuffled in, but no shuffleIntoLibraries comes before it",
    );
  });

  it('reports "each other player copies" outside a spell-cast trigger, where no player cast it', () => {
    const copy: Effect = { op: "copySpell", of: { target: 0 }, by: "eachOtherPlayer", newTargets: "may" };
    const spell: CardDef = {
      name: "Lightning Bolt",
      oracle: bolt.oracleText,
      spell: { targets: [{ kind: "spell", filter: {} }], effects: [copy] },
    };
    expect(definitionProblems([spell], [bolt])).toContain(
      'Lightning Bolt: "each other player" copies only in a spell-cast trigger',
    );
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

  it('reports "that player controls" or "that much" where nothing supplies them', () => {
    const red: TargetSpec = { kind: "permanent", filter: { colors: ["R"], controller: "triggeringPlayer" } };
    const enters: TriggeredAbilityDef = { when: { kind: "selfEnters" }, targets: [red], effects: [] };
    const gains: TriggeredAbilityDef = {
      when: { kind: "playerGainsLife", player: "you" },
      targets: [],
      effects: [{ op: "destroyAll", filter: { controller: "triggeringPlayer" } }],
    };
    const lose: Effect = { op: "loseLife", who: "you", amount: "thatMuch" };
    const attacks: TriggeredAbilityDef = { when: { kind: "selfAttacks" }, targets: [], effects: [lose] };
    const def: CardDef = {
      name: "Furnace Whelp",
      oracle: whelp.oracleText,
      keywords: ["flying"],
      triggers: [enters, gains, attacks],
      abilities: [{ kind: "activated", cost: [], targets: [], effects: [lose] }],
    };
    expect(definitionProblems([def], [whelp])).toStrictEqual([
      'Furnace Whelp ability 1: "that much" is only for a triggered ability',
      'Furnace Whelp trigger 1: its event has no "that player"',
      'Furnace Whelp trigger 2: only a target can be limited to what "that player" controls',
      'Furnace Whelp trigger 3: its event has no "that much"',
    ]);
  });

  it('reports "that creature", what was sacrificed and nested effects where they can\'t be read', () => {
    const toIt: Effect = { op: "dealDamage", amount: 3, from: "self", to: "triggeringObject" };
    const upkeep: TriggeredAbilityDef = {
      when: { kind: "beginningOfStep", step: "upkeep", whose: "yours" },
      targets: [],
      effects: [toIt],
    };
    const def: CardDef = {
      name: "Furnace Whelp",
      oracle: whelp.oracleText,
      keywords: ["flying"],
      triggers: [upkeep],
      abilities: [
        {
          kind: "activated",
          cost: [],
          targets: [{ kind: "anyTarget" }],
          effects: [
            { op: "loseLife", who: "you", amount: "sacrificedPower" },
            { op: "loseLife", who: "triggeringObject", amount: 1 },
            { op: "destroyOneAtRandom", among: ["you"] },
          ],
        },
        {
          kind: "activated",
          cost: [],
          targets: [{ kind: "anyTarget" }],
          effects: [
            { op: "sacrifice", who: "you", filter: { types: ["creature"] } },
            {
              op: "ifNothingSacrificed",
              effects: [
                {
                  op: "dealDamage",
                  amount: "sacrificedPower",
                  from: "self",
                  to: { target: 0 },
                  divided: "asYouChoose",
                },
                { op: "loseLife", who: "you", amount: "thatMuch" },
              ],
            },
          ],
        },
      ],
    };
    expect(definitionProblems([def], [whelp])).toStrictEqual([
      "Furnace Whelp ability 1: loseLife reads what was sacrificed, but no sacrifice comes before it",
      "Furnace Whelp ability 1: loseLife is for players, not objects",
      "Furnace Whelp ability 1: destroyOneAtRandom is for objects, not players",
      "Furnace Whelp ability 2: a divided amount is a number or X",
      "Furnace Whelp ability 2: a divided effect, mana or ifNothingSacrificed can't be inside ifNothingSacrificed",
      'Furnace Whelp ability 1: "that creature" is only for a triggered ability',
      'Furnace Whelp ability 2: "that much" is only for a triggered ability',
      'Furnace Whelp trigger 1: its event has no "that creature"',
    ]);
  });

  it("checks a delayed trigger as its own triggered ability, and an activation count only in an activated ability (D-078)", () => {
    const sacrifice: Effect[] = [{ op: "sacrificeSource" }];
    const endStep = { kind: "beginningOfStep", step: "end", whose: "each" } as const;
    const delayed = (fields: Partial<TriggeredAbilityDef>): Effect => ({
      op: "createDelayedTrigger",
      ability: { when: endStep, targets: [], effects: sacrifice, ...fields },
    });
    const counted: Effect = { op: "ifActivatedThisTurn", atLeast: 4, effects: [delayed({})] };
    const activated = (effects: Effect[]): AbilityDef => ({ kind: "activated", cost: [], targets: [], effects });
    const def: CardDef = {
      name: "Furnace Whelp",
      oracle: whelp.oracleText,
      keywords: ["flying"],
      spell: { targets: [], effects: [counted] },
      triggers: [{ when: { kind: "selfAttacks" }, targets: [], effects: [counted] }],
      abilities: [
        activated([counted]),
        activated([delayed({ when: { ...endStep, whose: "yours" } })]),
        activated([delayed({ when: { kind: "selfAttacks" } })]),
        activated([delayed({ targets: [{ kind: "anyTarget" }] })]),
        activated([delayed({ onlyIf: { kind: "sourceUntapped" } })]),
        activated([delayed({ optional: true })]),
        // "That player" is the player whose end step it is: the delayed trigger's own event supplies one.
        activated([delayed({ effects: [{ op: "loseLife", who: "triggeringPlayer", amount: 1 }] })]),
        // Its own resolution is a delayed trigger's, not an activated ability's: no activations to count.
        activated([delayed({ effects: [counted] })]),
      ],
    };
    const problems = definitionProblems([def], [whelp]);
    const cantWait = 'waits for the beginning of anyone\'s step, with no targets, intervening if or "you may"';
    expect(problems).toStrictEqual([
      "Furnace Whelp: ifActivatedThisTurn is only for an activated ability",
      "Furnace Whelp trigger 1: ifActivatedThisTurn is only for an activated ability",
      ...[2, 3, 4, 5, 6].map((i) => `Furnace Whelp ability ${i} delayed trigger: ${cantWait}`),
      "Furnace Whelp ability 8 delayed trigger: ifActivatedThisTurn is only for an activated ability",
    ]);
  });

  it('refuses a token\'s "*" without the ability that defines it, the ability without a "*", and other statics', () => {
    const ajaniCard = POOL.cards.find((c) => c.name === "Ajani Goldmane");
    const ajaniDef = CARD_DEFS.find((d) => d.name === "Ajani Goldmane");
    if (ajaniCard === undefined || ajaniDef?.abilities === undefined)
      throw new Error("Ajani Goldmane isn't in the pool");
    const abilities = ajaniDef.abilities;
    const withToken = (token: Partial<TokenDef>): CardDef => ({
      ...ajaniDef,
      abilities: abilities.map((a, i) =>
        i !== 2
          ? a
          : {
              ...a,
              effects: a.effects.map((e) => (e.op === "createTokens" ? { ...e, token: { ...e.token, ...token } } : e)),
            },
      ),
    });
    const star = 'Ajani Goldmane: a token\'s "*" needs an ability that defines it, and that ability needs a "*"';
    expect(definitionProblems([withToken({ statics: [] })], [ajaniCard])).toContain(star);
    expect(definitionProblems([withToken({ power: 1, toughness: 1 })], [ajaniCard])).toContain(star);
    const other = withToken({
      statics: [{ kind: "canBlockAnyNumber" }, { kind: "powerToughnessEachEqual", to: "yourLifeTotal" }],
    });
    expect(definitionProblems([other], [ajaniCard])).toContain(
      "Ajani Goldmane: a token's static abilities are only a characteristic-defining one so far",
    );
  });

  it("refuses a written entersWithLoyalty, two loyalty costs in one, and a loyalty ability with a timing", () => {
    const jaceCard = POOL.cards.find((c) => c.name === "Jace Beleren");
    const jaceDef = CARD_DEFS.find((d) => d.name === "Jace Beleren");
    if (jaceCard === undefined || jaceDef?.abilities === undefined) throw new Error("Jace Beleren isn't in the pool");
    const [plus, ...rest] = jaceDef.abilities;
    if (plus === undefined) throw new Error("Jace has no abilities");
    const twice = { ...plus, cost: [...plus.cost, ...plus.cost] };
    const timed = { ...plus, timing: "sorcery" as const };
    const bad: CardDef = {
      ...jaceDef,
      replacements: [{ kind: "entersWithLoyalty", loyalty: 3 }],
      abilities: [twice, timed, ...rest.slice(1)],
    };
    expect(definitionProblems([bad], [jaceCard])).toEqual(
      expect.arrayContaining([
        "Jace Beleren: entersWithLoyalty is intrinsic to a planeswalker; a definition doesn't write it",
        "Jace Beleren ability 1: more than one loyalty cost",
        "Jace Beleren ability 2: a loyalty ability's timing comes from its cost (CR 606.3)",
      ]),
    );
  });

  it("refuses [−X] with {X} in one cost, and an eachControlledBy that names an object or sets the controller", () => {
    const chandraCard = POOL.cards.find((c) => c.name === "Chandra Nalaar");
    const chandraDef = CARD_DEFS.find((d) => d.name === "Chandra Nalaar");
    if (chandraCard === undefined || chandraDef?.abilities === undefined)
      throw new Error("Chandra Nalaar isn't in the pool");
    const [plus, minusX, ultimate] = chandraDef.abilities;
    if (plus === undefined || minusX === undefined || ultimate === undefined)
      throw new Error("Chandra has 3 abilities");
    const bothX: AbilityDef = { ...minusX, cost: [...minusX.cost, { kind: "mana", cost: [{ kind: "x" }] }] };
    const subject = (target: number, controller?: "you"): Effect => ({
      op: "dealDamage",
      amount: 10,
      from: "self",
      to: { target: 0 },
      and: [
        {
          to: { eachControlledBy: { target }, filter: { types: ["creature"], ...(controller && { controller }) } },
          amount: 10,
        },
      ],
    });
    const spellTarget: TargetSpec = { kind: "spell", filter: {} };
    const onSpell: AbilityDef = { ...ultimate, targets: [...ultimate.targets, spellTarget], effects: [subject(1)] };
    const setsController: AbilityDef = { ...ultimate, effects: [subject(0, "you")] };
    const damageFrom: AbilityDef = {
      ...plus,
      effects: [
        { op: "dealDamage", amount: 1, from: { eachControlledBy: { target: 0 }, filter: {} }, to: { target: 0 } },
      ],
    };
    const bad: CardDef = { ...chandraDef, abilities: [plus, bothX, onSpell, setsController, damageFrom] };
    expect(definitionProblems([bad], [chandraCard])).toEqual(
      expect.arrayContaining([
        "Chandra Nalaar ability 2: both [−X] and {X} in one cost",
        "Chandra Nalaar ability 3: eachControlledBy names target 1, which isn't a player or permanent",
        "Chandra Nalaar ability 4: eachControlledBy sets the controller itself",
        "Chandra Nalaar ability 5: damage comes from one object",
      ]),
    );
  });

  it("refuses a doesntUntap on a player, or during more than one player's untap step", () => {
    const sleepCard = POOL.cards.find((c) => c.name === "Sleep");
    const sleepDef = CARD_DEFS.find((d) => d.name === "Sleep");
    if (sleepCard === undefined || sleepDef?.spell === undefined) throw new Error("Sleep isn't in the pool");
    const bad: CardDef = {
      ...sleepDef,
      spell: {
        ...sleepDef.spell,
        effects: [
          { op: "doesntUntap", of: { target: 0 }, during: { target: 0 } },
          { op: "doesntUntap", of: "self", during: "eachPlayer" },
          { op: "doesntUntap", of: "self", during: "self" },
          { op: "doesntUntap", of: "self", during: "eachOpponent" },
        ],
      },
    };
    expect(definitionProblems([bad], [sleepCard])).toEqual(
      expect.arrayContaining([
        "Sleep: doesntUntap acts on objects, not players",
        "Sleep: doesntUntap is during one player's untap step",
      ]),
    );
    expect(
      definitionProblems([bad], [sleepCard]).filter(
        (p) => p === "Sleep: doesntUntap is during one player's untap step",
      ),
    ).toHaveLength(3);
  });

  it("reports a missing keyword", () => {
    const def = { name: "Furnace Whelp", oracle: whelp.oracleText };
    expect(definitionProblems([def], [whelp])).toStrictEqual(['Furnace Whelp: keywords [], but Oracle has ["flying"]']);
  });

  it("reports protections that don't match the Oracle text (CR 702.16g)", () => {
    const knight = POOL.cards.find((c) => c.name === "White Knight");
    if (knight === undefined) throw new Error("White Knight isn't in the pool");
    const swapped: CardDef = {
      name: "White Knight",
      oracle: knight.oracleText,
      keywords: ["first strike"],
      protections: [{ kind: "color", color: "W" }],
    };
    expect(definitionProblems([swapped], [knight])).toStrictEqual([
      'White Knight: protections ["color W"], but Oracle has ["color B"]',
    ]);
  });

  it("reports a static ability's filter that asks about combat, which the layer pass can't (D-092)", () => {
    const honor = POOL.cards.find((c) => c.name === "Honor of the Pure");
    if (honor === undefined) throw new Error("Honor of the Pure isn't in the pool");
    const attacking: CardDef = {
      name: "Honor of the Pure",
      oracle: honor.oracleText,
      statics: [{ kind: "creaturesGet", filter: { types: ["creature"], combat: "attacking" }, power: 1, toughness: 1 }],
    };
    expect(definitionProblems([attacking], [honor])).toStrictEqual([
      `Honor of the Pure: a static ability's filter can't ask about combat or "that player" (D-092)`,
    ]);
    // The top card's filter is read in the pass too, and "self" and "others" contradict each other.
    const topInCombat: CardDef = {
      name: "Honor of the Pure",
      oracle: honor.oracleText,
      statics: [
        {
          kind: "creaturesGet",
          filter: { types: ["creature"] },
          asLongAs: { topOfLibrary: { combat: "attacking" } },
          power: 1,
          toughness: 1,
        },
      ],
    };
    expect(definitionProblems([topInCombat], [honor])).toStrictEqual([
      `Honor of the Pure: a static ability's filter can't ask about combat or "that player" (D-092)`,
    ]);
    const both: CardDef = {
      name: "Honor of the Pure",
      oracle: honor.oracleText,
      statics: [
        { kind: "creaturesGet", filter: { types: ["creature"] }, self: true, others: true, power: 1, toughness: 1 },
      ],
    };
    expect(definitionProblems([both], [honor])).toStrictEqual([
      "Honor of the Pure: a creaturesGet can't be both self and others",
    ]);
  });

  it('reports a printed "*" without an ability that defines it, and such an ability without a "*" (CR 208.2a)', () => {
    const nightmare = POOL.cards.find((c) => c.name === "Nightmare");
    const bears = POOL.cards.find((c) => c.name === "Grizzly Bears");
    if (nightmare === undefined || bears === undefined) throw new Error("Nightmare or Grizzly Bears missing");
    const undefinedStar: CardDef = { name: "Nightmare", oracle: nightmare.oracleText, keywords: ["flying"] };
    const definedBears: CardDef = {
      name: "Grizzly Bears",
      oracle: bears.oracleText,
      statics: [{ kind: "powerToughnessEachEqual", to: { count: { subtypes: ["Forest"], controller: "you" } } }],
    };
    expect(definitionProblems([undefinedStar, definedBears], [nightmare, bears])).toStrictEqual([
      'Nightmare: a printed "*" needs an ability that defines it, and that ability needs a "*"',
      'Grizzly Bears: a printed "*" needs an ability that defines it, and that ability needs a "*"',
    ]);
    // "*/3" with an ability that sets both: its toughness would be overwritten.
    const halfStar = { ...nightmare, toughness: "3" };
    const nightmareDef = CARD_DEFS.find((d) => d.name === "Nightmare");
    if (nightmareDef === undefined) throw new Error("Nightmare has no definition");
    expect(definitionProblems([nightmareDef], [halfStar])).toStrictEqual([
      'Nightmare: a printed "*" needs an ability that defines it, and that ability needs a "*"',
    ]);
  });

  it("reports a characteristic-defining count that asks about combat, and a defending player's filter with a controller", () => {
    const serpent = POOL.cards.find((c) => c.name === "Serpent of the Endless Sea");
    if (serpent === undefined) throw new Error("Serpent of the Endless Sea missing");
    const def: CardDef = {
      name: "Serpent of the Endless Sea",
      oracle: serpent.oracleText,
      statics: [
        { kind: "powerToughnessEachEqual", to: { count: { types: ["creature"], combat: "attacking" } } },
        { kind: "cantAttackUnlessDefenderControls", filter: { subtypes: ["Island"], controller: "opponent" } },
      ],
    };
    expect(definitionProblems([def], [serpent])).toStrictEqual([
      `Serpent of the Endless Sea: a static ability's filter can't ask about combat or "that player" (D-092)`,
      'Serpent of the Endless Sea: "defending player controls" already says whose permanents are counted',
    ]);
  });

  it('reports "that creature" (remembered) where nothing names it: outside a delayed ability, or without `about`', () => {
    const giant = POOL.cards.find((c) => c.name === "Stone Giant");
    const real = CARD_DEFS.find((d) => d.name === "Stone Giant");
    if (giant === undefined || real === undefined) throw new Error("Stone Giant missing");
    // Without `about` on the delayed trigger's maker; or with "remembered" in the ability's own effects.
    const changed = (withoutAbout: boolean): CardDef => ({
      ...real,
      abilities: (real.abilities ?? []).map((a) => ({
        ...a,
        effects: a.effects.map((e) => {
          if (e.op !== "createDelayedTrigger") return withoutAbout ? e : { op: "destroy", of: "remembered" };
          if (!withoutAbout) return e;
          const { about: _, ...rest } = e;
          return rest;
        }),
      })),
    });
    expect(definitionProblems([changed(true)], [giant])).toStrictEqual([
      'Stone Giant: a delayed ability that says "that creature" needs its maker\'s `about`',
    ]);
    expect(definitionProblems([changed(false)], [giant])).toStrictEqual([
      'Stone Giant: "remembered" is only for a delayed triggered ability',
    ]);
    // Inside a condition it's still a delayed ability's own word, not the condition's.
    const conditional: CardDef = {
      ...real,
      abilities: (real.abilities ?? []).map((a) => ({
        ...a,
        effects: [{ op: "ifActivatedThisTurn", atLeast: 1, effects: a.effects }],
      })),
    };
    expect(definitionProblems([conditional], [giant]).filter((p) => p.includes("remembered"))).toStrictEqual([]);
    // Remembering a player names no creature.
    const player: CardDef = {
      ...real,
      abilities: (real.abilities ?? []).map((a) => ({
        ...a,
        effects: a.effects.map((e) => (e.op === "createDelayedTrigger" ? { ...e, about: "you" } : e)),
      })),
    };
    expect(definitionProblems([player], [giant])).toContain(
      "Stone Giant ability 1: createDelayedTrigger acts on objects, not players",
    );
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
    expect(definitionProblems([def([{ op: "extraTurn", who: "self" }])], [offering])).toStrictEqual([
      "Solemn Offering: extraTurn is for players, not objects",
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

  it("reports 'found' with no search before it, a same-name search with no exile before it, each player searching, and an unchosen name", () => {
    const tutor = POOL.cards.find((c) => c.name === "Diabolic Tutor");
    if (tutor === undefined) throw new Error("Diabolic Tutor missing from the pool");
    const def = (effects: Effect[]): CardDef => ({
      name: "Diabolic Tutor",
      oracle: tutor.oracleText,
      spell: { targets: [], effects },
    });
    expect(definitionProblems([def([{ op: "put", of: "found", into: "hand" }])], [tutor])).toStrictEqual([
      "Diabolic Tutor: put names the cards found, but no search, reveal or choice comes before it",
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
    const search: Effect = { op: "search", library: "you", count: "one" };
    const putUnnamed: Effect = {
      op: "put",
      of: "found",
      into: "battlefield",
      onlyIf: { types: ["creature"], notNamedThisWay: true },
    };
    expect(definitionProblems([def([search, putUnnamed])], [tutor])).toStrictEqual([
      "Diabolic Tutor: a filter reads the name chosen this way, but no nameCard comes before it",
    ]);
    expect(definitionProblems([def([search, { op: "nameCard", who: "you" }, putUnnamed])], [tutor])).toStrictEqual([]);
    // After the put, inside "not", or named by each player: all refused.
    expect(definitionProblems([def([search, putUnnamed, { op: "nameCard", who: "you" }])], [tutor])).toStrictEqual([
      "Diabolic Tutor: a filter reads the name chosen this way, but no nameCard comes before it",
    ]);
    const putNamed: Effect = {
      op: "put",
      of: "found",
      into: "battlefield",
      onlyIf: { not: { notNamedThisWay: true } },
    };
    expect(definitionProblems([def([search, putNamed])], [tutor])).toStrictEqual([
      "Diabolic Tutor: a filter reads the name chosen this way, but no nameCard comes before it",
    ]);
    expect(definitionProblems([def([search, { op: "nameCard", who: "eachPlayer" }])], [tutor])).toStrictEqual([
      "Diabolic Tutor: nameCard names one player, not each player",
    ]);
    const targeting: CardDef = {
      name: "Diabolic Tutor",
      oracle: tutor.oracleText,
      spell: { targets: [{ kind: "permanent", filter: { notNamedThisWay: true } }], effects: [search] },
    };
    expect(definitionProblems([targeting], [tutor])).toStrictEqual([
      "Diabolic Tutor: only an effect's filter can read a name chosen while it resolves",
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
      "Earthquake: a divided amount is a number or X",
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
