// Replacement effects in the pipeline (CR 614): what the pool's cards can't show in a scenario.

import { describe, expect, it } from "vitest";
import type { GameState, ObjectId } from "../../src/index.ts";
import { happen } from "../../src/pipeline/happen.ts";
import { FOREST, GROVE, TEST_CARDS } from "../support/cards.ts";
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
  it("replace each event of a batch against the state before the batch: a land entering with a Forest doesn't see it (CR 614.4)", () => {
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
});
