// The layer pass and what it keeps (D-092, D-093): what no pool card can show. A kept pass follows every one of its
// inputs, the rule modifiers included; a static ability's set found in layer 6 is kept for 7c (CR 613.6).

import { describe, expect, it } from "vitest";
import type { GameState, ObjectId } from "../../src/index.ts";
import { layeredOf, layeredOfFresh } from "../../src/rules/layers.ts";
import { powerAndToughness } from "../../src/rules/power-toughness.ts";
import { BEARS, FOREST, GROUNDED_ANTHEM, TEST_CARDS } from "../support/cards.ts";
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
