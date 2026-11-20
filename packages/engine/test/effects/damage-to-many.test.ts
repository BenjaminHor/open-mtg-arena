// Damage to many and "spend only black mana on X" (M2-05c1), where a scenario can't see the difference: one damage
// event for every recipient of one action, and a payment restriction that leaves the printed cost alone.

import { describe, expect, it } from "vitest";
import { runEffect } from "../../src/effects/run-effect.ts";
import type { CardDatabase, GameState, ObjectId } from "../../src/index.ts";
import { totalCost } from "../../src/rules/costs.ts";
import { BEARS, HAMMER, TEST_CARDS } from "../support/cards.ts";
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

const context = { self: "o999" as ObjectId, controller: "p1" as const, targets: [], division: [], x: 2 };

describe("one action dealing damage to many is one damage event (CR 608.2f, 120.4)", () => {
  it("Earthquake deals all of its damage before any of it turns into life loss", () => {
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
    const types = quake.events.map((e) => e.type);
    // Two creatures and two players, dealt damage in the one event, then the players' results.
    expect(types.filter((t) => t === "DAMAGE_DEALT")).toHaveLength(4);
    expect(types.lastIndexOf("DAMAGE_DEALT")).toBeLessThan(types.indexOf("LIFE_LOST"));
    expect(quake.state.players.p1?.life).toBe(18);
    expect(quake.state.players.p2?.life).toBe(18);
  });
});

describe("'Spend only black mana on X' (Consume Spirit)", () => {
  it("makes each X a {B} in the cost to pay, and leaves the printed mana cost as it is (CR 601.2h, 107.4b)", () => {
    // Volcanic Hammer as a spell costing {X}{1}{B} with X paid in black.
    const hammer = TEST_CARDS[HAMMER];
    if (hammer === undefined) throw new Error("no Hammer");
    const printed = [
      { kind: "x" } as const,
      { kind: "generic", amount: 1 } as const,
      { kind: "colored", color: "B" } as const,
    ];
    const cards: CardDatabase = {
      ...TEST_CARDS,
      [HAMMER]: {
        ...hammer,
        printed: { ...hammer.printed, manaCost: printed },
        def: { ...hammer.def, spell: { targets: [], effects: [], xPaidWith: "B" } },
      },
    };
    const state = start({
      seed: 1,
      players: [playerSetup("p1", { library: ["forest"], hand: [HAMMER] }), playerSetup("p2", { library: ["forest"] })],
      opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
      ruleModifiers: [],
    }).state;
    const id = state.zones.players.p1?.hand[0] as ObjectId;
    const card = state.objects[id];
    if (card?.kind !== "card") throw new Error("no card");
    const onStack = {
      ...state,
      objects: { ...state.objects, [id]: { ...card, choices: { modes: [], x: 2, targets: [], division: null } } },
    };
    expect(totalCost(onStack, id, cards)).toStrictEqual([
      { kind: "colored", color: "B" },
      { kind: "colored", color: "B" },
      { kind: "generic", amount: 1 },
      { kind: "colored", color: "B" },
    ]);
    expect(cards[HAMMER]?.printed.manaCost).toStrictEqual(printed);
  });
});
