// characteristics() and layer 7 (CR 613), for what the scenarios can't reach: a creature spell on the stack, cards in
// hand, an ability on the stack, all of 7c at once, and an effect whose object changed zones.

import { describe, expect, it } from "vitest";
import { runEffect } from "../../src/effects/run-effect.ts";
import { type CardObject, characteristics, type GameSetup, type GameState, type ObjectId } from "../../src/index.ts";
import { moveCard } from "../../src/zones/move-card.ts";
import { midTurnState } from "../state/fixture.ts";
import { BEARS, STATUE, TEST_CARDS } from "../support/cards.ts";
import { type Game, playerSetup, start, take } from "../support/game.ts";

const permanent = (oracleId: string) => ({ oracleId, tapped: false, summoningSick: false, damage: 0, counters: {} });

/** p1 in their main phase with two Forests and Grizzly Bears in hand; creatures p1 controls get +1/+1. */
function setup(): Game {
  const s: GameSetup = {
    seed: 1,
    players: [
      playerSetup("p1", {
        library: ["forest"],
        hand: [BEARS],
        battlefield: [permanent("forest"), permanent("forest")],
      }),
      playerSetup("p2", { library: ["forest"] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [{ kind: "creaturesGetPT", controller: "p1", power: 1, toughness: 1 }],
  };
  return start(s);
}

describe("rule modifiers apply only to creature permanents (CR 109.2)", () => {
  it("doesn't change a creature card in hand or a creature spell on the stack, only the permanent", () => {
    let game = setup();
    const inHand = game.state.zones.players.p1?.hand[0] as ObjectId;
    expect(characteristics(game.state, inHand, TEST_CARDS)).toMatchObject({ power: 2, toughness: 2 });
    game = take(game, (a) => a.type === "CAST_SPELL");
    while (game.state.pending?.kind === "payMana") {
      game = take(game, (a) => (a.type === "ANSWER" && a.answer.kind === "payMana") || a.type === "ACTIVATE_ABILITY");
    }
    const spell = game.state.zones.stack[0] as ObjectId;
    expect(characteristics(game.state, spell, TEST_CARDS)).toMatchObject({ power: 2, toughness: 2 });
    game = take(
      take(game, (a) => a.type === "PASS_PRIORITY"),
      (a) => a.type === "PASS_PRIORITY",
    );
    const bears = game.state.zones.battlefield.at(-1) as ObjectId;
    expect(characteristics(game.state, bears, TEST_CARDS)).toMatchObject({ power: 3, toughness: 3, controller: "p1" });
  });
});

describe("characteristics()", () => {
  it("gives the printed values of a card, with its controller and types (CR 109.3)", () => {
    const game = setup();
    const forest = game.state.zones.battlefield[0] as ObjectId;
    expect(characteristics(game.state, forest, TEST_CARDS)).toStrictEqual({
      name: "Forest",
      controller: "p1",
      supertypes: ["basic"],
      types: ["land"],
      subtypes: ["Forest"],
      colors: [],
      keywords: [],
      power: null,
      toughness: null,
    });
  });

  it("refuses an ability on the stack, which has no card: ask controllerOf instead", () => {
    const state = midTurnState();
    expect(state.objects.o11?.kind).toBe("ability");
    expect(() => characteristics(state, "o11", TEST_CARDS)).toThrow(/isn't a card/);
  });
});

describe("a noncreature with a printed power and toughness (CR 208.3)", () => {
  it("has none as a permanent, but has its printed ones elsewhere", () => {
    const game = start({
      seed: 1,
      players: [
        playerSetup("p1", { library: ["forest"], hand: [STATUE], battlefield: [permanent(STATUE)] }),
        playerSetup("p2", { library: ["forest"] }),
      ],
      opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
      ruleModifiers: [],
    });
    const onBattlefield = game.state.zones.battlefield[0] as ObjectId;
    const inHand = game.state.zones.players.p1?.hand[0] as ObjectId;
    expect(characteristics(game.state, onBattlefield, TEST_CARDS)).toMatchObject({ power: null, toughness: null });
    expect(characteristics(game.state, inHand, TEST_CARDS)).toMatchObject({ power: 4, toughness: 5 });
  });
});

describe("layer 7c (CR 613.4c)", () => {
  it("adds effects, counters and rule modifiers together, going below zero on the way (CR 107.1b)", () => {
    const game = setup();
    const forest = game.state.zones.battlefield[0] as ObjectId;
    const bears = { ...withCounters(game, forest, { "-1/-1": 3 }) };
    // Turn the Forest into a stand-in Grizzly Bears permanent with three -1/-1 counters, under p1's +1/+1 modifier.
    const state: GameState = {
      ...bears,
      objects: { ...bears.objects, [forest]: { ...(bears.objects[forest] as CardObject), oracleId: BEARS } },
    };
    expect(characteristics(state, forest, TEST_CARDS)).toMatchObject({ power: 0, toughness: 0 });
    const pumped = runEffect(
      state,
      { op: "modifyPT", power: 3, toughness: 3, of: { target: 0 }, duration: "endOfTurn" },
      {
        self: forest,
        controller: "p1",
        targets: [[{ kind: "object", object: forest }]],
        division: [],
        x: null,
        trigger: null,
      },
      TEST_CARDS,
    ).state;
    expect(characteristics(pumped, forest, TEST_CARDS)).toMatchObject({ power: 3, toughness: 3 });
  });

  it("counts +1/+1 counters on a creature card in another zone, but not on a noncreature card (CR 122.1a)", () => {
    const game = start({
      seed: 1,
      players: [
        playerSetup("p1", { library: ["forest"], hand: [BEARS, STATUE] }),
        playerSetup("p2", { library: ["forest"] }),
      ],
      opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
      ruleModifiers: [],
    });
    const [bears, statue] = (game.state.zones.players.p1?.hand ?? []) as [ObjectId, ObjectId];
    const state = withCounters({ state: withCounters(game, bears, { "+1/+1": 1 }), events: [] }, statue, {
      "+1/+1": 1,
    });
    expect(characteristics(state, bears, TEST_CARDS)).toMatchObject({ power: 3, toughness: 3 });
    expect(characteristics(state, statue, TEST_CARDS)).toMatchObject({ power: 4, toughness: 5 });
  });
});

describe("an effect on an object that's gone (CR 400.7)", () => {
  it("no longer applies once its object changes zones, even if the card comes back", () => {
    const game = setup(); // creatures p1 controls get +1/+1
    const inHand = game.state.zones.players.p1?.hand[0] as ObjectId;
    const entered = moveCard(game.state, inHand, { zone: "battlefield", controller: "p1" }).state;
    const bears = entered.zones.battlefield.at(-1) as ObjectId;
    const pumped = runEffect(
      entered,
      { op: "modifyPT", power: 3, toughness: 3, of: { target: 0 }, duration: "endOfTurn" },
      {
        self: bears,
        controller: "p1",
        targets: [[{ kind: "object", object: bears }]],
        division: [],
        x: null,
        trigger: null,
      },
      TEST_CARDS,
    ).state;
    expect(characteristics(pumped, bears, TEST_CARDS)).toMatchObject({ power: 6, toughness: 6 });
    const toHand = moveCard(pumped, bears, { zone: "hand" }).state;
    const back = toHand.zones.players.p1?.hand.at(-1) as ObjectId;
    const returned = moveCard(toHand, back, { zone: "battlefield", controller: "p1" }).state;
    const again = returned.zones.battlefield.at(-1) as ObjectId;
    expect(again).not.toBe(bears);
    // The effect stays until cleanup, but on the old id only (CR 400.7): the new object is 2/2 plus the modifier.
    expect(returned.effects.map((e) => e.affected)).toStrictEqual([[bears]]);
    expect(characteristics(returned, again, TEST_CARDS)).toMatchObject({ power: 3, toughness: 3 });
  });
});

function withCounters(game: Game, id: ObjectId, counters: Record<string, number>): GameState {
  const obj = game.state.objects[id] as CardObject;
  return { ...game.state, objects: { ...game.state.objects, [id]: { ...obj, counters } } };
}
