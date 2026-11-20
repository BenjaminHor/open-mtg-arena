// Replacement effects in the pipeline (CR 614): what the pool's cards can't show in a scenario.

import { describe, expect, it } from "vitest";
import { checkStateBasedActions } from "../../src/game/state-based-actions.ts";
import type { GameState, ObjectId } from "../../src/index.ts";
import { happen } from "../../src/pipeline/happen.ts";
import { DUAL, FOREST, GROVE, HOLLOW_STATUE, HOMING_BEAR, TEST_CARDS } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

function board(): GameState {
  return start({
    seed: 1,
    players: [playerSetup("p1", { library: [FOREST], hand: [FOREST, GROVE] }), playerSetup("p2", { library: [] })],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  }).state;
}

const hand = (s: GameState) => (s.zones.players.p1?.hand ?? []) as [ObjectId, ObjectId];
const permanent = (s: GameState, oracleId: string) =>
  s.zones.battlefield.map((id) => s.objects[id]).find((o) => o?.kind === "card" && o.oracleId === oracleId);

describe("replacement effects", () => {
  it("replace each event of a batch against the state before the batch: a land entering with a Forest doesn't see it (CR 614.1, the checklands' ruling)", () => {
    const state = board();
    const [forest, grove] = hand(state);
    const enter = (object: ObjectId) =>
      ({ kind: "moveCard", object, to: { zone: "battlefield", controller: "p1" } }) as const;
    const together = happen(state, { kind: "simultaneous", events: [enter(forest), enter(grove)] }, TEST_CARDS);
    expect(permanent(together.state, GROVE)).toMatchObject({ tapped: true });
    // One after the other, the Forest is already there as the Grove enters.
    const first = happen(state, enter(forest), TEST_CARDS);
    const then = happen(first.state, enter(grove), TEST_CARDS);
    expect(permanent(then.state, GROVE)).toMatchObject({ tapped: false });
  });

  it("check land types, not names: a nonbasic land that is a Forest counts (the checklands' ruling)", () => {
    const state = withBattlefield([DUAL], [GROVE]);
    const [grove] = hand(state);
    const entered = happen(
      state,
      { kind: "moveCard", object: grove, to: { zone: "battlefield", controller: "p1" } },
      TEST_CARDS,
    );
    expect(permanent(entered.state, GROVE)).toMatchObject({ tapped: false });
  });

  it("change where a destroyed card goes, not that it was destroyed (CR 614.1a, D-085)", () => {
    const state = withBattlefield([HOMING_BEAR]);
    const [bear] = state.zones.battlefield as [ObjectId];
    const destroyed = happen(state, { kind: "destroy", object: bear }, TEST_CARDS);
    expect(destroyed.events.map((e) => e.type)).toContain("PERMANENT_DESTROYED");
    expect(destroyed.state.zones.battlefield).toStrictEqual([]);
    expect(destroyed.state.zones.players.p1?.graveyard).toStrictEqual([]);
    expect(destroyed.state.zones.players.p1?.library).toHaveLength(2);
  });

  it("leave a move to exile alone: only a graveyard is replaced", () => {
    const state = withBattlefield([HOMING_BEAR]);
    const [bear] = state.zones.battlefield as [ObjectId];
    const exiled = happen(state, { kind: "moveCard", object: bear, to: { zone: "exile" } }, TEST_CARDS);
    expect(exiled.state.zones.exile).toHaveLength(1);
    expect(exiled.state.zones.players.p1?.library).toHaveLength(1);
  });
});

describe("indestructible", () => {
  it("doesn't stop a creature with toughness 0 or less going to the graveyard (CR 704.5f, 702.12b)", () => {
    // A 0/0 on the battlefield as the game starts would already be gone: it enters now, with no check yet.
    const state = withBattlefield([], [HOLLOW_STATUE]);
    const [statue] = hand(state);
    const entered = happen(
      state,
      { kind: "moveCard", object: statue, to: { zone: "battlefield", controller: "p1" } },
      TEST_CARDS,
    );
    expect(entered.state.zones.battlefield).toHaveLength(1);
    const after = checkStateBasedActions(entered.state, TEST_CARDS).state;
    expect(after.zones.battlefield).toStrictEqual([]);
    expect(after.zones.players.p1?.graveyard).toHaveLength(1);
  });
});

/** p1 with one Forest in their library, these permanents, and this hand. */
function withBattlefield(oracleIds: string[], inHand: string[] = []): GameState {
  return start({
    seed: 1,
    players: [
      playerSetup("p1", {
        library: [FOREST],
        hand: inHand,
        battlefield: oracleIds.map((oracleId) => ({
          oracleId,
          tapped: false,
          summoningSick: false,
          damage: 0,
          counters: {},
        })),
      }),
      playerSetup("p2", { library: [] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  }).state;
}
