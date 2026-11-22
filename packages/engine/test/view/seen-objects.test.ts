// seenObjects (D-135, D-137): the derived values of what one player sees, and nothing they don't. That two worlds
// differing only in hidden cards give the same seen objects is checked over many scenario states by the CLI's
// `brief.test.ts`; these tests check the shape.

import { describe, expect, it } from "vitest";
import { type GameState, type ObjectId, playerView, seenObjects } from "../../src/index.ts";
import { BEARS, FOREST, TEST_CARDS } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

const permanent = (oracleId: string, summoningSick: boolean) => ({
  oracleId,
  tapped: false,
  summoningSick,
  damage: 0,
  counters: {},
});

function board(): GameState {
  return start({
    seed: 1,
    players: [
      playerSetup("p1", { hand: [BEARS], library: [FOREST], battlefield: [permanent(BEARS, true)] }),
      playerSetup("p2", { hand: [BEARS], library: [FOREST], battlefield: [permanent(BEARS, false)] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  }).state;
}

describe("seenObjects", () => {
  it("describes exactly the objects in the viewer's view: their own hand, not the opponent's or any library", () => {
    const state = board();
    const seen = seenObjects(state, playerView(state, "p1", TEST_CARDS), TEST_CARDS);
    expect(Object.keys(seen).sort()).toStrictEqual(
      [...state.zones.battlefield, ...(state.zones.players.p1?.hand ?? [])].sort(),
    );
  });

  it("gives each card's characteristics and status as the layer system derives them", () => {
    const state = board();
    const [mine, theirs] = state.zones.battlefield as [ObjectId, ObjectId];
    const seen = seenObjects(state, playerView(state, "p1", TEST_CARDS), TEST_CARDS);
    expect(seen[mine]).toMatchObject({
      kind: "card",
      oracleId: BEARS,
      owner: "p1",
      token: false,
      tapped: false,
      summoningSick: true,
      attacking: null,
      blocking: [],
      characteristics: { name: "Grizzly Bears", controller: "p1", power: 2, toughness: 2 },
    });
    expect(seen[theirs]).toMatchObject({ summoningSick: false, characteristics: { controller: "p2" } });
  });
});
