// Target restrictions (CR 115) for what the YAML scenarios can't reach yet: scenarios use the real card pool, and the
// cards with most of these restrictions also need effects that come later (M2-05). Each restriction is checked with a
// case it allows and one it refuses.

import { describe, expect, it } from "vitest";
import type { ObjectFilter, TargetSpec } from "../../src/cards/types.ts";
import type { GameState, ObjectId } from "../../src/index.ts";
import { applyAction, legalActions } from "../../src/index.ts";
import { legalTargets, targetsProblem } from "../../src/rules/targets.ts";
import { newCombat } from "../../src/state/combat.ts";
import type { Target } from "../../src/state/objects.ts";
import { moveCard } from "../../src/zones/move-card.ts";
import { putAbilityOnStack } from "../../src/zones/stack-abilities.ts";
import { BEARS, KNIGHT, PINGER, SPLIT, STATUE, TEST_CARDS, UP_TO_TWO } from "../support/cards.ts";
import { type Game, passBoth, playerSetup, start, take } from "../support/game.ts";

const permanent = (oracleId: string, tapped = false) => ({
  oracleId,
  tapped,
  summoningSick: false,
  damage: 0,
  counters: {},
});

/**
 * p1 controls Grizzly Bears (green, Bear), a tapped White-Blue Knight, a Statue (an artifact) and a Mountain; p2 controls
 * Grizzly Bears. p1's graveyard has a Shock and p2's a Grizzly Bears.
 */
function board(): GameState {
  return start({
    seed: 1,
    players: [
      playerSetup("p1", {
        library: ["forest"],
        hand: ["shock", "shock"],
        graveyard: ["shock"],
        battlefield: [permanent(BEARS), permanent(KNIGHT, true), permanent(STATUE), permanent("mountain")],
      }),
      playerSetup("p2", { library: ["forest"], graveyard: [BEARS], battlefield: [permanent(BEARS)] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  }).state;
}

const [bears, knight, statue, mountain, theirBears] = board().zones.battlefield as [
  ObjectId,
  ObjectId,
  ObjectId,
  ObjectId,
  ObjectId,
];
const byP1 = { object: "o999" as ObjectId, controller: "p1" as const };
const ids = (targets: Target[]) => targets.map((t) => (t.kind === "object" ? t.object : t.player));
const permanents = (filter: ObjectFilter, state = board()) =>
  ids(legalTargets(state, { kind: "permanent", filter }, byP1, TEST_CARDS));

describe("restrictions on a permanent (CR 115.2)", () => {
  it("only permanents: no cards in hands, graveyards or libraries", () => {
    expect(permanents({})).toStrictEqual([bears, knight, statue, mountain, theirBears]);
  });

  it("card types, any of and none of: 'target creature', 'artifact or creature', 'nonland'", () => {
    expect(permanents({ types: ["creature"] })).toStrictEqual([bears, knight, theirBears]);
    expect(permanents({ types: ["artifact", "creature"] })).toStrictEqual([bears, knight, statue, theirBears]);
    expect(permanents({ notTypes: ["land"] })).toStrictEqual([bears, knight, statue, theirBears]);
  });

  it("colors, any of and none of: 'white and/or blue', 'nonblack', 'nongreen' (CR 105.2c: colorless has no color)", () => {
    expect(permanents({ colors: ["W", "U"] })).toStrictEqual([knight]);
    expect(permanents({ colors: ["U"] })).toStrictEqual([knight]);
    expect(permanents({ colors: ["B"] })).toStrictEqual([]);
    expect(permanents({ notColors: ["B"] })).toStrictEqual([bears, knight, statue, mountain, theirBears]);
    expect(permanents({ notColors: ["G"] })).toStrictEqual([knight, statue, mountain]);
  });

  it("subtypes, any of: 'target Knight', 'Skeleton, Vampire, or Zombie'", () => {
    expect(permanents({ subtypes: ["Knight"] })).toStrictEqual([knight]);
    expect(permanents({ subtypes: ["Zombie", "Bear"] })).toStrictEqual([bears, theirBears]);
    expect(permanents({ subtypes: ["Zombie"] })).toStrictEqual([]);
  });

  it("'target tapped creature'", () => {
    expect(permanents({ types: ["creature"], tapped: true })).toStrictEqual([knight]);
  });

  it("who controls it, relative to the spell's controller (CR 102.2)", () => {
    expect(permanents({ types: ["creature"], controller: "you" })).toStrictEqual([bears, knight]);
    expect(permanents({ types: ["creature"], controller: "notYou" })).toStrictEqual([theirBears]);
    // With no teams, every other player is an opponent.
    expect(permanents({ types: ["creature"], controller: "opponent" })).toStrictEqual([theirBears]);
  });

  it("attacking and blocking creatures, read from combat (CR 508.1k, 509.1g, 506.4)", () => {
    const state: GameState = {
      ...board(),
      combat: {
        ...newCombat(),
        attacks: [{ attacker: bears, defender: "p2" }],
        blocks: [{ blocker: theirBears, attacker: bears }],
      },
    };
    expect(permanents({ combat: "attacking" }, state)).toStrictEqual([bears]);
    expect(permanents({ combat: "blocking" }, state)).toStrictEqual([theirBears]);
    expect(permanents({ combat: "attackingOrBlocking" }, state)).toStrictEqual([bears, theirBears]);
    expect(permanents({ combat: "blocking" })).toStrictEqual([]);
  });
});

describe("targets in other zones (CR 115.2)", () => {
  it("'target player or planeswalker': players only, with no planeswalkers yet", () => {
    expect(ids(legalTargets(board(), { kind: "playerOrPlaneswalker" }, byP1, TEST_CARDS))).toStrictEqual(["p1", "p2"]);
  });

  it("a card in your graveyard or in any graveyard: a zone, not control (CR 109.2a, 109.4)", () => {
    const state = board();
    const mine = state.zones.players.p1?.graveyard[0];
    const theirs = state.zones.players.p2?.graveyard[0];
    const card = (graveyard: "yours" | "any", filter: ObjectFilter) =>
      ids(legalTargets(state, { kind: "cardInGraveyard", graveyard, filter }, byP1, TEST_CARDS));
    expect(card("yours", {})).toStrictEqual([mine]);
    expect(card("any", {})).toStrictEqual([mine, theirs]);
    // A card's characteristics are read in the graveyard too: "creature card".
    expect(card("any", { types: ["creature"] })).toStrictEqual([theirs]);
    // A card in a graveyard isn't controlled by anyone, not even its owner (CR 109.4).
    expect(card("yours", { controller: "you" })).toStrictEqual([]);
    expect(card("any", { controller: "notYou" })).toStrictEqual([]);
  });

  it("a spell: a card on the stack, never an ability (CR 112.1), and never itself (CR 115.5)", () => {
    let state = board();
    const [shock, otherShock] = (state.zones.players.p1?.hand ?? []) as [ObjectId, ObjectId];
    state = moveCard(state, shock, { zone: "stack", controller: "p1" }).state;
    state = moveCard(state, otherShock, { zone: "stack", controller: "p1" }).state;
    state = putAbilityOnStack(state, statue, PINGER, { kind: "printed", index: 0 }, "p1").state;
    const [first, second] = state.zones.stack as [ObjectId, ObjectId];
    const spells = (object: ObjectId) =>
      ids(legalTargets(state, { kind: "spell", filter: {} }, { object, controller: "p1" }, TEST_CARDS));
    expect(spells(first)).toStrictEqual([second]);
    expect(spells(second)).toStrictEqual([first]);
    // "Target creature spell": the Shocks aren't.
    const creatureSpells = legalTargets(
      state,
      { kind: "spell", filter: { types: ["creature"] } },
      { object: first, controller: "p1" },
      TEST_CARDS,
    );
    expect(creatureSpells).toStrictEqual([]);
  });
});

describe("what can target what", () => {
  it("an ability can target its own source: only the ability itself can't be its target (CR 115.5)", () => {
    const state = start({
      seed: 1,
      players: [
        playerSetup("p1", { library: ["forest"], battlefield: [permanent(PINGER)] }),
        playerSetup("p2", { library: ["forest"] }),
      ],
      opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
      ruleModifiers: [],
    }).state;
    const pinger = state.zones.battlefield[0] as ObjectId;
    const targets = legalTargets(state, { kind: "anyTarget" }, { object: pinger, controller: "p1" }, TEST_CARDS);
    expect(ids(targets)).toStrictEqual([pinger, "p1", "p2"]);
  });
});

describe("how many targets (CR 601.2c, 115.6)", () => {
  const creature: TargetSpec = { kind: "permanent", filter: { types: ["creature"], colors: ["W"] } };

  it("an instance needs at least its minimum of different legal choices, and none when it allows zero", () => {
    const state = board();
    expect(targetsProblem(state, [creature], byP1, TEST_CARDS)).toBeNull();
    expect(targetsProblem(state, [{ ...creature, count: { min: 2, max: 3 } }], byP1, TEST_CARDS)).toMatch(/enough/);
    const black: TargetSpec = { kind: "permanent", filter: { colors: ["B"] }, count: { min: 0, max: 2 } };
    expect(targetsProblem(state, [black], byP1, TEST_CARDS)).toBeNull();
  });

  it("a spell cast with zero targets isn't targeted, so it resolves normally (CR 115.6)", () => {
    let game: Game = start({
      seed: 1,
      players: [
        playerSetup("p1", { library: ["forest"], hand: [UP_TO_TWO], battlefield: [permanent("forest")] }),
        playerSetup("p2", { library: ["forest"], battlefield: [permanent(BEARS)] }),
      ],
      opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
      ruleModifiers: [],
    });
    game = take(game, (a) => a.type === "CAST_SPELL");
    expect(game.state.pending).toMatchObject({ kind: "chooseTargetCount", min: 0, max: 1 });
    game = take(game, (a) => a.type === "ANSWER" && a.answer.kind === "chooseTargetCount" && a.answer.count === 0);
    game = take(game, (a) => a.type === "ACTIVATE_ABILITY");
    game = take(game, (a) => a.type === "ANSWER" && a.answer.kind === "payMana");
    const after = passBoth(game);
    expect(after.events.some((e) => e.type === "SPELL_RESOLVED")).toBe(true);
    expect(after.events.some((e) => e.type === "SPELL_DID_NOT_RESOLVE")).toBe(false);
  });

  it("for a division, no more targets than the amount, since each gets at least one (CR 601.2d)", () => {
    let game: Game = start({
      seed: 1,
      players: [
        playerSetup("p1", { library: ["forest"], hand: [SPLIT], battlefield: [permanent("mountain")] }),
        playerSetup("p2", { library: ["forest"], battlefield: [permanent(BEARS), permanent(BEARS), permanent(BEARS)] }),
      ],
      opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
      ruleModifiers: [],
    });
    game = take(game, (a) => a.type === "CAST_SPELL");
    const counts = (g: Game) =>
      legalActions(g.state, "p1", TEST_CARDS).flatMap((a) =>
        a.type === "ANSWER" && a.answer.kind === "chooseTargetCount" ? [a.answer.count] : [],
      );
    expect(counts(game)).toStrictEqual([1, 2]);
    game = take(game, (a) => a.type === "ANSWER" && a.answer.kind === "chooseTargetCount" && a.answer.count === 2);
    game = take(game, (a) => a.type === "ANSWER" && a.answer.kind === "chooseTarget");
    game = take(game, (a) => a.type === "ANSWER" && a.answer.kind === "chooseTarget");
    // The first of two targets can have 1, leaving 1 for the second.
    const shares = legalActions(game.state, "p1", TEST_CARDS).flatMap((a) =>
      a.type === "ANSWER" && a.answer.kind === "divide" ? [a.answer.amount] : [],
    );
    expect(shares).toStrictEqual([1]);
  });

  it("the text's maximum caps the count even when the amount would allow more (CR 601.2c)", () => {
    const split = TEST_CARDS[SPLIT];
    if (split === undefined) throw new Error("no Split");
    // "4 damage divided as you choose among one, two, or three target creatures", with four creatures out.
    const cards = {
      ...TEST_CARDS,
      [SPLIT]: {
        ...split,
        def: {
          ...split.def,
          spell: {
            targets: [{ kind: "permanent", filter: { types: ["creature"] }, count: { min: 1, max: 3 } }],
            effects: [{ op: "dealDamage", amount: 4, from: "self", to: { target: 0 }, divided: "asYouChoose" }],
          },
        },
      },
    } as typeof TEST_CARDS;
    let game: Game = start({
      seed: 1,
      players: [
        playerSetup("p1", { library: ["forest"], hand: [SPLIT], battlefield: [permanent("mountain")] }),
        playerSetup("p2", {
          library: ["forest"],
          battlefield: [permanent(BEARS), permanent(BEARS), permanent(BEARS), permanent(BEARS)],
        }),
      ],
      opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
      ruleModifiers: [],
    });
    const cast = legalActions(game.state, "p1", cards).find((a) => a.type === "CAST_SPELL");
    if (cast === undefined) throw new Error("can't cast Split");
    const result = applyAction(game.state, cast, cards);
    if (!result.ok) throw new Error(result.error.message);
    game = { state: result.state, events: result.events };
    expect(game.state.pending).toMatchObject({ kind: "chooseTargetCount", min: 1, max: 3 });
  });
});
