// Counters put and removed (D-099), and the state-based action for +1/+1 and -1/-1 counters together (CR 704.5q): what
// no pool card can show yet, removing more than there are, and a creature that also dies in the same batch.

import { describe, expect, it } from "vitest";
import { checkStateBasedActions } from "../../src/game/state-based-actions.ts";
import type { GameState, ObjectId } from "../../src/index.ts";
import { removeCounters } from "../../src/permanents/counters.ts";
import { BEARS, FOREST, TEST_CARDS } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

function bearsWith(counters: Record<string, number>): { state: GameState; bears: ObjectId } {
  const state = start({
    seed: 1,
    players: [
      playerSetup("p1", {
        library: [FOREST],
        battlefield: [{ oracleId: BEARS, tapped: false, summoningSick: false, damage: 0, counters }],
      }),
      playerSetup("p2", { library: [FOREST] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  }).state;
  const bears = state.zones.battlefield[0] ?? (state.zones.players.p1?.graveyard[0] as ObjectId);
  return { state, bears };
}

describe("removeCounters", () => {
  it("removes only as many as there are, and nothing from an object that's gone (CR 101.3)", () => {
    const { state, bears } = bearsWith({ "+1/+1": 1 });
    const removed = removeCounters(state, bears, "+1/+1", 3);
    expect(removed.events).toStrictEqual([{ type: "COUNTERS_REMOVED", object: bears, counter: "+1/+1", amount: 1 }]);
    const obj = removed.state.objects[bears];
    expect(obj?.kind === "card" && obj.counters).toStrictEqual({});
    expect(removeCounters(state, "o999" as ObjectId, "+1/+1", 1).events).toStrictEqual([]);
  });
});

describe("+1/+1 and -1/-1 counters together (CR 704.5q)", () => {
  it("are removed in the same batch as the creature dying, which leaves with its counters as they were (CR 704.3)", () => {
    // Set up without the game having checked yet: put the counters on after it began.
    const { state, bears } = bearsWith({});
    const obj = state.objects[bears];
    if (obj?.kind !== "card") throw new Error("no Grizzly Bears");
    const counters = { "+1/+1": 1, "-1/-1": 3 };
    const before: GameState = { ...state, objects: { ...state.objects, [bears]: { ...obj, counters } } };
    const checked = checkStateBasedActions(before, TEST_CARDS);
    const removed = checked.events.filter((e) => e.type === "COUNTERS_REMOVED");
    expect(removed.map((e) => e.type === "COUNTERS_REMOVED" && [e.counter, e.amount])).toStrictEqual([
      ["+1/+1", 1],
      ["-1/-1", 1],
    ]);
    expect(checked.state.zones.battlefield).not.toContain(bears);
    const lastKnown = checked.state.lastKnown[bears];
    expect(lastKnown?.counters).toStrictEqual(counters);
  });
});
