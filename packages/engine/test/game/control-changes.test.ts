// A control change makes a permanent summoning sick again (CR 302.6): what Act of Treason's haste hides in any game.

import { describe, expect, it } from "vitest";
import { endUntilEndOfTurnEffects } from "../../src/effects/continuous-effect.ts";
import { recordControlChanges } from "../../src/game/control-changes.ts";
import type { GameState, ObjectId } from "../../src/index.ts";
import { controllerOf } from "../../src/rules/controller.ts";
import { newCombat } from "../../src/state/combat.ts";
import { BEARS, FOREST, TEST_CARDS } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

const permanent = (oracleId: string) => ({ oracleId, tapped: false, summoningSick: false, damage: 0, counters: {} });

function bearsOfP2(): { state: GameState; bears: ObjectId } {
  const state = start({
    seed: 1,
    players: [
      playerSetup("p1", { library: [FOREST] }),
      playerSetup("p2", { library: [FOREST], battlefield: [permanent(BEARS)] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  }).state;
  const [bears] = state.zones.battlefield as [ObjectId];
  return { state, bears };
}

const stolen = (state: GameState, bears: ObjectId): GameState => ({
  ...state,
  effects: [
    {
      source: bears,
      controller: "p1",
      timestamp: 900,
      duration: "endOfTurn",
      affected: [bears],
      change: { kind: "gainControl", player: "p1" },
    },
  ],
});

function withControlledSinceTurnStart(state: GameState, id: ObjectId): GameState {
  const obj = state.objects[id];
  if (obj?.kind !== "card") throw new Error(`${id} isn't a card`);
  return { ...state, objects: { ...state.objects, [id]: { ...obj, controlledSinceTurnStart: true } } };
}

const sick = (state: GameState, id: ObjectId) => {
  const obj = state.objects[id];
  return obj?.kind === "card" && !obj.controlledSinceTurnStart;
};

describe("a control change (CR 302.6, 613.1b)", () => {
  it("gives the permanent to the effect's player, and makes it summoning sick", () => {
    const { state, bears } = bearsOfP2();
    const after = recordControlChanges(state, stolen(state, bears), TEST_CARDS);
    expect(controllerOf(after, bears, TEST_CARDS)).toBe("p1");
    expect(sick(state, bears)).toBe(false);
    expect(sick(after, bears)).toBe(true);
  });

  it("makes it summoning sick again as the effect ends and it goes back", () => {
    const { state, bears } = bearsOfP2();
    // As if p1's turn had begun under the effect: p1 has controlled it since.
    const taken = stolen(state, bears);
    const settled = withControlledSinceTurnStart(taken, bears);
    // `advance` compares controllers before and after each piece of work: the effect ending is one.
    const back = recordControlChanges(settled, endUntilEndOfTurnEffects(settled).state, TEST_CARDS);
    expect(controllerOf(back, bears, TEST_CARDS)).toBe("p2");
    expect(sick(back, bears)).toBe(true);
  });

  it("gives it to the latest control effect's player, in timestamp order (CR 613.7)", () => {
    const { state, bears } = bearsOfP2();
    const first = stolen(state, bears).effects[0] as GameState["effects"][number];
    const twice: GameState = {
      ...state,
      effects: [first, { ...first, timestamp: 901, change: { kind: "gainControl", player: "p2" } }],
    };
    expect(controllerOf(twice, bears, TEST_CARDS)).toBe("p2");
    // Timestamps decide, not where the effects are listed (CR 613.7).
    expect(controllerOf({ ...twice, effects: [...twice.effects].reverse() }, bears, TEST_CARDS)).toBe("p2");
    // The later one ending leaves the earlier one's player in control, not the owner.
    expect(controllerOf({ ...twice, effects: [first] }, bears, TEST_CARDS)).toBe("p1");
  });

  it("changes nothing when the permanent's controller stays the same", () => {
    const { state, bears } = bearsOfP2();
    const own: GameState = {
      ...state,
      effects: [
        {
          ...(stolen(state, bears).effects[0] as GameState["effects"][number]),
          change: { kind: "gainControl", player: "p2" },
        },
      ],
    };
    expect(sick(recordControlChanges(state, own, TEST_CARDS), bears)).toBe(false);
  });

  it("removes an attacking or blocking permanent from combat (CR 506.4)", () => {
    const { state, bears } = bearsOfP2();
    const attacking: GameState = {
      ...state,
      combat: { ...newCombat(), attacks: [{ attacker: bears, defender: "p1" }] },
    };
    const after = recordControlChanges(attacking, stolen(attacking, bears), TEST_CARDS);
    expect(after.combat?.removed).toStrictEqual([bears]);
  });
});
