// Matching trigger conditions where the pool can't show it: one creature blocking two attackers (only Palace Guard
// can block more than one, and it has no block trigger), and "when this creature dies" on a permanent that isn't a
// creature when it dies (no pool card changes a creature's types away).

import { describe, expect, it } from "vitest";
import type { GameState, ObjectId } from "../../src/index.ts";
import { happen } from "../../src/pipeline/happen.ts";
import { matches } from "../../src/triggers/match-event.ts";
import { TEST_CARDS, TEST_RELIC } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

describe("whenever this creature blocks a creature (CR 509.3b)", () => {
  it("triggers once for each attacking creature it blocks, that creature being each one", () => {
    const [wall, other, a1, a2] = ["o1", "o2", "o3", "o4"] as ObjectId[];
    const blocks = [
      { blocker: wall as ObjectId, attacker: a1 as ObjectId },
      { blocker: wall as ObjectId, attacker: a2 as ObjectId },
      { blocker: other as ObjectId, attacker: a1 as ObjectId },
    ];
    const found = matches(
      {} as GameState,
      wall as ObjectId,
      { kind: "selfBlocks" },
      { type: "BLOCKERS_DECLARED", player: "p2", blocks },
      TEST_CARDS,
    );
    expect(found.map((t) => t.object)).toStrictEqual([a1, a2]);
  });
});

describe("when this creature dies (CR 700.4, 700.7)", () => {
  it("triggers for its permanent put into a graveyard from the battlefield, even if it isn't a creature then", () => {
    const state = start({
      seed: 1,
      players: [
        playerSetup("p1", {
          library: ["forest"],
          battlefield: [{ oracleId: TEST_RELIC, tapped: false, summoningSick: false, damage: 0, counters: {} }],
        }),
        playerSetup("p2", { library: ["forest"] }),
      ],
      opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
      ruleModifiers: [],
    }).state;
    const relic = state.zones.battlefield[0] as ObjectId;
    const destroyed = happen(state, { kind: "destroy", object: relic }, TEST_CARDS);
    expect(destroyed.state.pendingTriggers.map((t) => [t.source, t.controller])).toStrictEqual([[relic, "p1"]]);
  });
});
