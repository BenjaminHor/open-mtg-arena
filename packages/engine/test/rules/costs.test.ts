// The cost to pay (CR 601.2f): "spend only black mana on X" (Consume Spirit, D-067). Only `totalCost` reads
// `xPaidWith`; the card's mana cost isn't touched, so its color and mana value can't change (CR 107.4b).

import { describe, expect, it } from "vitest";
import type { CardDatabase, ObjectId } from "../../src/index.ts";
import { totalCost } from "../../src/rules/costs.ts";
import { HAMMER, TEST_CARDS } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

describe("'Spend only black mana on X' (Consume Spirit)", () => {
  it("makes each X a {B} in the cost to pay, so only black mana pays it (CR 601.2h)", () => {
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
  });
});
