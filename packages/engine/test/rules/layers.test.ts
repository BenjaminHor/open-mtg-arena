// The layer pass and what it keeps (D-092, D-093): what no pool card can show. A kept pass follows every one of its
// inputs, the rule modifiers included; a static ability's set found in layer 6 is kept for 7c (CR 613.6).

import { describe, expect, it } from "vitest";
import type { Becomes, GameState, ObjectId } from "../../src/index.ts";
import { layeredOf, layeredOfFresh } from "../../src/rules/layers.ts";
import { powerAndToughness } from "../../src/rules/power-toughness.ts";
import { BEARS, FOREST, FOREST_COUNTER, GROUNDED_ANTHEM, LIFE_AVATAR, TEST_CARDS } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

const permanent = (oracleId: string) => ({ oracleId, tapped: false, summoningSick: false, damage: 0, counters: {} });

function withBears(...others: string[]): { state: GameState; bears: ObjectId } {
  const state = start({
    seed: 1,
    players: [
      playerSetup("p1", { library: [FOREST], battlefield: [permanent(BEARS), ...others.map(permanent)] }),
      playerSetup("p2", { library: [FOREST] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  }).state;
  const [bears] = state.zones.battlefield as [ObjectId];
  return { state, bears };
}

describe("the kept layer pass (D-092)", () => {
  it("follows the rule modifiers, though the objects are the same", () => {
    const { state, bears } = withBears();
    expect(powerAndToughness(state, bears, TEST_CARDS)).toStrictEqual({ power: 2, toughness: 2 });
    const modified: GameState = {
      ...state,
      setup: { ...state.setup, ruleModifiers: [{ kind: "creaturesGetPT", controller: "p1", power: 5, toughness: 5 }] },
    };
    expect(powerAndToughness(modified, bears, TEST_CARDS)).toStrictEqual({ power: 7, toughness: 7 });
    // And back: the first state's pass is still the one kept for it.
    expect(powerAndToughness(state, bears, TEST_CARDS)).toStrictEqual({ power: 2, toughness: 2 });
  });

  it("follows a life total, though the objects are the same, but not a mana pool (CR 604.3)", () => {
    const { state } = withBears(LIFE_AVATAR);
    const avatar = state.zones.battlefield[1] as ObjectId;
    expect(powerAndToughness(state, avatar, TEST_CARDS)).toStrictEqual({ power: 20, toughness: 20 });
    const p1 = state.players.p1;
    if (p1 === undefined) throw new Error("no p1");
    const hurt: GameState = { ...state, players: { ...state.players, p1: { ...p1, life: 7 } } };
    expect(powerAndToughness(hurt, avatar, TEST_CARDS)).toStrictEqual({ power: 7, toughness: 7 });
    expect(powerAndToughness(state, avatar, TEST_CARDS)).toStrictEqual({ power: 20, toughness: 20 });
    // Mana in the pool changes no characteristic, so the pass is reused, the very same record.
    const paid: GameState = {
      ...state,
      players: { ...state.players, p1: { ...p1, manaPool: { ...p1.manaPool, G: 1 } } },
    };
    expect(layeredOf(paid, avatar, TEST_CARDS)).toBe(layeredOf(state, avatar, TEST_CARDS));
  });

  it("reads a life total for a card off the battlefield from its own state, under a pass shared by two totals", () => {
    const state = start({
      seed: 1,
      players: [
        playerSetup("p1", { library: [LIFE_AVATAR], battlefield: [permanent(BEARS)] }),
        playerSetup("p2", { library: [FOREST] }),
      ],
      opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
      ruleModifiers: [],
    }).state;
    const [bears] = state.zones.battlefield as [ObjectId];
    const [avatar] = state.zones.players.p1?.library ?? [];
    const p1 = state.players.p1;
    if (avatar === undefined || p1 === undefined) throw new Error("no Life Avatar in the library");
    const hurt: GameState = { ...state, players: { ...state.players, p1: { ...p1, life: 7 } } };
    // Nothing on the battlefield reads a life total, so both states share one pass.
    powerAndToughness(state, bears, TEST_CARDS);
    powerAndToughness(hurt, bears, TEST_CARDS);
    // Each reads its own (CR 604.3: the ability works in the library too).
    expect(powerAndToughness(hurt, avatar, TEST_CARDS)).toStrictEqual({ power: 7, toughness: 7 });
    expect(powerAndToughness(state, avatar, TEST_CARDS)).toStrictEqual({ power: 20, toughness: 20 });
    expect(layeredOf(hurt, avatar, TEST_CARDS)).toStrictEqual(layeredOfFresh(hurt, avatar, TEST_CARDS));
  });

  it("is what a fresh pass gives, for a card on the battlefield and one in a library", () => {
    const { state, bears } = withBears();
    const [inLibrary] = state.zones.players.p1?.library ?? [];
    if (inLibrary === undefined) throw new Error("no card in the library");
    for (const id of [bears, inLibrary])
      expect(layeredOf(state, id, TEST_CARDS)).toStrictEqual(layeredOfFresh(state, id, TEST_CARDS));
  });
});

describe("an effect keeps its set from its first layer (CR 613.6)", () => {
  it("gives a creature without flying both its flying (layer 6) and its +1/+1 (7c)", () => {
    const { state, bears } = withBears(GROUNDED_ANTHEM);
    const card = layeredOf(state, bears, TEST_CARDS);
    expect(card?.keywords).toContain("flying");
    expect([card?.power, card?.toughness]).toStrictEqual([3, 3]);
  });
});

describe("the base power and toughness: 7b over 7a over printed (CR 613.4a, 613.4b)", () => {
  // A "becomes 4/5" effect from a resolved ability, on `id`, as Awakener Druid makes (D-095).
  const setTo = (state: GameState, id: ObjectId): GameState => ({
    ...state,
    effects: [
      ...state.effects,
      {
        source: id,
        controller: "p1",
        timestamp: 999,
        duration: "endOfTurn",
        affected: [id],
        change: { kind: "becomes", addTypes: [], addSubtypes: [], setPT: { power: 4, toughness: 5 } },
      },
    ],
  });

  it("sets a printed creature's power and toughness, and 7c still adds", () => {
    const { state, bears } = withBears(GROUNDED_ANTHEM);
    // Grizzly Bears is 2/2, +1/+1 from the anthem in 7c; set to 4/5 in 7b, it's 5/6.
    expect(powerAndToughness(setTo(state, bears), bears, TEST_CARDS)).toStrictEqual({ power: 5, toughness: 6 });
  });

  it("sets over a characteristic-defining ability's values, applied before it", () => {
    const { state } = withBears(FOREST_COUNTER, FOREST);
    const counter = state.zones.battlefield[1];
    if (counter === undefined) throw new Error("no Forest Counter");
    expect(powerAndToughness(state, counter, TEST_CARDS)).toStrictEqual({ power: 1, toughness: 1 });
    expect(powerAndToughness(setTo(state, counter), counter, TEST_CARDS)).toStrictEqual({ power: 4, toughness: 5 });
    expect(layeredOf(setTo(state, counter), counter, TEST_CARDS)?.base).toStrictEqual({
      from: "effect",
      source: counter,
      power: 4,
      toughness: 5,
    });
  });
});

describe("effects in one layer apply in timestamp order (CR 613.7)", () => {
  // Effects from resolved abilities on `id`, made in this order: `state.effects` is in timestamp order.
  const withEffects = (state: GameState, id: ObjectId, ...changes: Becomes[]): GameState => ({
    ...state,
    effects: changes.map((change, i) => ({
      source: id,
      controller: "p1",
      timestamp: 900 + i,
      duration: "endOfTurn",
      affected: [id],
      change: { kind: "becomes", ...change },
    })),
  });
  const plain = { addTypes: [], addSubtypes: [] };

  it("in layer 5, a later 'becomes green' replaces an earlier added black, and a later added black adds to green", () => {
    const { state, bears } = withBears();
    const setG = { ...plain, colors: { set: ["G" as const] } };
    const addB = { ...plain, colors: { add: ["B" as const] } };
    expect(layeredOf(withEffects(state, bears, addB, setG), bears, TEST_CARDS)?.colors).toStrictEqual(["G"]);
    expect(layeredOf(withEffects(state, bears, setG, addB), bears, TEST_CARDS)?.colors).toStrictEqual(["B", "G"]);
  });

  it("in layer 7b, the later of two set effects stands", () => {
    const { state, bears } = withBears();
    const small = { ...plain, setPT: { power: 1, toughness: 1 } };
    const big = { ...plain, setPT: { power: 4, toughness: 5 } };
    expect(powerAndToughness(withEffects(state, bears, small, big), bears, TEST_CARDS)).toStrictEqual({
      power: 4,
      toughness: 5,
    });
    expect(powerAndToughness(withEffects(state, bears, big, small), bears, TEST_CARDS)).toStrictEqual({
      power: 1,
      toughness: 1,
    });
  });
});

describe("a creature with no power or toughness has 0 (CR 208.5)", () => {
  it("is 0/0 when a land becomes a creature with none set", () => {
    const { state } = withBears(FOREST);
    const forest = state.zones.battlefield[1];
    if (forest === undefined) throw new Error("no Forest");
    const animated: GameState = {
      ...state,
      effects: [
        {
          source: forest,
          controller: "p1",
          timestamp: 900,
          duration: "endOfTurn",
          affected: [forest],
          change: { kind: "becomes", addTypes: ["creature"], addSubtypes: [] },
        },
      ],
    };
    expect(powerAndToughness(state, forest, TEST_CARDS)).toStrictEqual({ power: null, toughness: null });
    expect(powerAndToughness(animated, forest, TEST_CARDS)).toStrictEqual({ power: 0, toughness: 0 });
  });
});
