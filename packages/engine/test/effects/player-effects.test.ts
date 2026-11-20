// Player effects (M2-05b1) where the order matters, which the YAML scenarios can't check: "each player" in APNAP order
// with the second player active, one draw event per card, and random discards picked with the seeded RNG.

import { describe, expect, it } from "vitest";
import { runEffect } from "../../src/effects/run-effect.ts";
import { apnapOrder } from "../../src/game/turn-order.ts";
import type { GameState } from "../../src/index.ts";
import { randomInt } from "../../src/rng/xoshiro128.ts";
import type { ObjectId, PlayerId } from "../../src/state/ids.ts";
import { BEARS, FOREST, MOUNTAIN, TEST_CARDS } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

const library = Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? FOREST : MOUNTAIN));

/** A game in p2's precombat main phase, each player with the given hand and a 10-card library. */
function p2Active(hands: { p1: string[]; p2: string[] } = { p1: [], p2: [] }): GameState {
  return start({
    seed: 7,
    players: [playerSetup("p1", { library, hand: hands.p1 }), playerSetup("p2", { library, hand: hands.p2 })],
    opening: { kind: "fixed", turn: { number: 4, activePlayer: "p2", step: "precombatMain" } },
    ruleModifiers: [],
  }).state;
}

const context = { self: "o999" as ObjectId, controller: "p1" as PlayerId, targets: [], division: [], x: null };

describe("each player, in APNAP order (CR 101.4)", () => {
  it("starts with the active player, then the others in turn order", () => {
    expect(apnapOrder(p2Active())).toStrictEqual(["p2", "p1"]);
  });

  it("draws all of the active player's cards first, one event per card (CR 121.2, 121.2c)", () => {
    const result = runEffect(p2Active(), { op: "draw", who: "eachPlayer", amount: 3 }, context, TEST_CARDS);
    const drawn = result.events.flatMap((e) => (e.type === "CARD_DRAWN" ? [e.player] : []));
    expect(drawn).toStrictEqual(["p2", "p2", "p2", "p1", "p1", "p1"]);
  });
});

describe("discarding at random (CR 701.9b)", () => {
  it("picks with the seeded RNG, the active player's cards first, and advances it", () => {
    const hand = [BEARS, FOREST, MOUNTAIN, BEARS, FOREST];
    const state = p2Active({ p1: hand, p2: hand });
    const result = runEffect(state, { op: "discardAtRandom", who: "eachPlayer", amount: 2 }, context, TEST_CARDS);

    // The same picks worked out here: p2's two from their hand, then p1's two, from one RNG.
    let rng = state.rng;
    const expected: string[] = [];
    for (const player of ["p2", "p1"] as const) {
      const left = [...(state.zones.players[player]?.hand ?? [])];
      for (let i = 0; i < 2; i++) {
        const pick = randomInt(rng, left.length);
        rng = pick.rng;
        expected.push(...left.splice(pick.value, 1));
      }
    }
    const discarded = result.events.flatMap((e) =>
      e.type === "ZONE_CHANGED" && e.from.zone === "hand" ? [e.oldId] : [],
    );
    expect(discarded).toStrictEqual(expected);
    expect(result.state.rng).toStrictEqual(rng);
    expect(result.state.rng).not.toStrictEqual(state.rng);
  });

  it("discards the whole hand when it's smaller, as much as possible (CR 609.3)", () => {
    const state = p2Active({ p1: [BEARS], p2: [] });
    const result = runEffect(state, { op: "discardAtRandom", who: "eachPlayer", amount: 2 }, context, TEST_CARDS);
    expect(result.state.zones.players.p1?.hand).toStrictEqual([]);
    expect(result.state.zones.players.p1?.graveyard).toHaveLength(1);
  });
});
