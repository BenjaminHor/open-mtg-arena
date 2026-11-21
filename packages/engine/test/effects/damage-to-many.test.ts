// Damage to many (M2-05c1), where a scenario can't see the difference: one damage event for every recipient of one
// action (CR 608.2f, 120.4).

import { describe, expect, it } from "vitest";
import { runEffect } from "../../src/effects/run-effect.ts";
import type { GameState, ObjectId } from "../../src/index.ts";
import { BEARS, TEST_CARDS, TEST_WALKER } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

const permanent = (oracleId: string) => ({ oracleId, tapped: false, summoningSick: false, damage: 0, counters: {} });

function board(): GameState {
  return start({
    seed: 1,
    players: [
      playerSetup("p1", { library: ["forest"], battlefield: [permanent(BEARS)] }),
      playerSetup("p2", { library: ["forest"], battlefield: [permanent(BEARS)] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  }).state;
}

const context = { self: "o999" as ObjectId, controller: "p1" as const, targets: [], division: [], x: 2, trigger: null };

describe("one action dealing damage to many is one damage event (CR 608.2f, 120.4)", () => {
  it("Goblin Artillery's 2 to a player and 3 to its controller are both dealt before either loses life", () => {
    // Split into two events, the first player's life loss would come between the two DAMAGE_DEALT.
    const state = board();
    const artillery = runEffect(
      state,
      { op: "dealDamage", amount: 2, from: "self", to: { target: 0 }, and: [{ to: "you", amount: 3 }] },
      { ...context, self: state.zones.battlefield[0] as ObjectId, targets: [[{ kind: "player", player: "p2" }]] },
      TEST_CARDS,
    );
    const types = artillery.events.map((e) => e.type);
    expect(types).toStrictEqual(["DAMAGE_DEALT", "DAMAGE_DEALT", "LIFE_LOST", "LIFE_LOST"]);
    expect(artillery.state.players.p2?.life).toBe(18);
    expect(artillery.state.players.p1?.life).toBe(17);
  });

  it("Earthquake deals damage to each creature without flying and each player", () => {
    const state = board();
    const quake = runEffect(
      state,
      {
        op: "dealDamage",
        amount: "X",
        from: "self",
        to: { each: { types: ["creature"], notKeywords: ["flying"] } },
        and: [{ to: "eachPlayer", amount: "X" }],
      },
      { ...context, self: state.zones.battlefield[0] as ObjectId },
      TEST_CARDS,
    );
    expect(quake.events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(4);
    expect(quake.state.players.p1?.life).toBe(18);
  });

  it("Chandra Nalaar's -8 on a stolen planeswalker hits its controller's creatures, not its owner's", () => {
    // p2 owns the walker and a Bears; p1 controls the walker now, and has a Bears of its own.
    const game = start({
      seed: 1,
      players: [
        playerSetup("p1", { library: ["forest"], battlefield: [permanent(BEARS)] }),
        playerSetup("p2", {
          library: ["forest"],
          battlefield: [{ ...permanent(TEST_WALKER), counters: { loyalty: 5 } }, permanent(BEARS)],
        }),
      ],
      opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
      ruleModifiers: [],
    }).state;
    const [p1Bears, walker, p2Bears] = game.zones.battlefield as ObjectId[];
    const steal = {
      source: p1Bears as ObjectId,
      controller: "p1" as const,
      timestamp: 999,
      duration: "endOfTurn" as const,
      affected: [walker as ObjectId],
      change: { kind: "gainControl" as const, player: "p1" as const },
    };
    const state = { ...game, effects: [...game.effects, steal] };
    const ultimate = runEffect(
      state,
      {
        op: "dealDamage",
        amount: 10,
        from: "self",
        to: { target: 0 },
        and: [{ to: { eachControlledBy: { target: 0 }, filter: { types: ["creature"] } }, amount: 10 }],
      },
      { ...context, self: p2Bears as ObjectId, targets: [[{ kind: "object", object: walker as ObjectId }]] },
      TEST_CARDS,
    );
    const hit = ultimate.events.flatMap((e) => (e.type === "DAMAGE_DEALT" ? [e.to] : []));
    expect(hit).toStrictEqual([
      { kind: "object", object: walker },
      { kind: "object", object: p1Bears },
    ]);
  });
});
