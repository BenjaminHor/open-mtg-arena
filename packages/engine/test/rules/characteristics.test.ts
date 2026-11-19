// characteristics() and layer 7 (CR 613), for what the scenarios can't reach: a creature spell on the stack, a card in
// hand, an ability on the stack, and an effect whose object is gone.

import { describe, expect, it } from "vitest";
import { runEffect } from "../../src/effects/run-effect.ts";
import { characteristics, type GameSetup, type ObjectId } from "../../src/index.ts";
import { moveCard } from "../../src/zones/move-card.ts";
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
  it("gives the printed values of a card, with its controller and types", () => {
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
    const game = setup();
    expect(() => characteristics(game.state, "o999", TEST_CARDS)).toThrow(/isn't a card/);
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

describe("an effect on an object that's gone (CR 400.7)", () => {
  it("isn't created for an object that left the battlefield after resolution began (CR 101.3)", () => {
    const game = setup();
    const forest = game.state.zones.battlefield[0] as ObjectId;
    const gone = moveCard(game.state, forest, { zone: "graveyard" }).state;
    const result = runEffect(
      gone,
      { op: "modifyPT", power: 3, toughness: 3, of: { target: 0 }, duration: "endOfTurn" },
      { self: forest, controller: "p1", targets: [[{ kind: "object", object: forest }]] },
      TEST_CARDS,
    );
    expect(result.state.effects).toStrictEqual([]);
    expect(result.events).toStrictEqual([]);
  });
});
