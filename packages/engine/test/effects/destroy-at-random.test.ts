// "Destroy one of them at random" (Capricious Efreet): exactly one of the still-legal targets, each with a chance, picked
// with the game's seeded RNG (no Math.random). The scenarios can only show the cases with one candidate left.

import { describe, expect, it } from "vitest";
import { destroyOneAtRandom } from "../../src/effects/destroy-at-random.ts";
import type { GameState, ObjectId } from "../../src/index.ts";
import { seedRng } from "../../src/rng/xoshiro128.ts";
import { BEARS, TEST_CARDS } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

const permanent = (oracleId: string) => ({ oracleId, tapped: false, summoningSick: false, damage: 0, counters: {} });

function board(): GameState {
  return start({
    seed: 1,
    players: [
      playerSetup("p1", { library: ["forest"], battlefield: [permanent(BEARS)] }),
      playerSetup("p2", { library: ["forest"], battlefield: [permanent(BEARS), permanent(BEARS)] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  }).state;
}

describe("destroying one of them at random", () => {
  it("destroys exactly one of the targets, any of them, depending on the seeded RNG", () => {
    const state = board();
    const [mine, a, b] = state.zones.battlefield as [ObjectId, ObjectId, ObjectId];
    const context = {
      self: mine,
      controller: "p1" as const,
      targets: [
        [{ kind: "object" as const, object: mine }],
        [a, b].map((object) => ({ kind: "object" as const, object })),
      ],
      division: [],
      x: null,
      trigger: null,
    };
    const picked = new Set<ObjectId>();
    for (let seed = 1; seed <= 40; seed++) {
      const done = destroyOneAtRandom(
        { ...state, rng: seedRng(seed) },
        [{ target: 0 }, { target: 1 }],
        context,
        TEST_CARDS,
      );
      const destroyed = done.events.flatMap((e) => (e.type === "PERMANENT_DESTROYED" ? [e.object] : []));
      expect(destroyed).toHaveLength(1);
      picked.add(destroyed[0] as ObjectId);
      expect(done.state.rng).not.toStrictEqual(seedRng(seed));
    }
    expect([...picked].sort()).toStrictEqual([mine, a, b].sort());
  });
});
