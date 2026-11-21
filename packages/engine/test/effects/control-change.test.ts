// A control change makes a permanent summoning sick again (CR 302.6): what Act of Treason's haste hides in any game.

import { describe, expect, it } from "vitest";
import { endUntilEndOfTurnEffects } from "../../src/effects/continuous-effect.ts";
import { recordControlChanges } from "../../src/effects/control-change.ts";
import type { GameState, ObjectId } from "../../src/index.ts";
import { controllerOf } from "../../src/rules/controller.ts";
import { BEARS, FOREST } from "../support/cards.ts";
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
    const after = recordControlChanges(state, stolen(state, bears), [bears]);
    expect(controllerOf(after, bears)).toBe("p1");
    expect(sick(state, bears)).toBe(false);
    expect(sick(after, bears)).toBe(true);
  });

  it("makes it summoning sick again as the effect ends and it goes back", () => {
    const { state, bears } = bearsOfP2();
    // As if p1's turn had begun under the effect: p1 has controlled it since.
    const taken = stolen(state, bears);
    const settled = withControlledSinceTurnStart(taken, bears);
    const back = endUntilEndOfTurnEffects(settled).state;
    expect(controllerOf(back, bears)).toBe("p2");
    expect(sick(back, bears)).toBe(true);
  });

  it("gives it to the latest control effect's player, in timestamp order (CR 613.7)", () => {
    const { state, bears } = bearsOfP2();
    const first = stolen(state, bears).effects[0] as GameState["effects"][number];
    const twice: GameState = {
      ...state,
      effects: [first, { ...first, timestamp: 901, change: { kind: "gainControl", player: "p2" } }],
    };
    expect(controllerOf(twice, bears)).toBe("p2");
    expect(controllerOf({ ...twice, effects: [...twice.effects].reverse() }, bears)).toBe("p1");
    // The later one ending leaves the earlier one's player in control, not the owner.
    expect(controllerOf({ ...twice, effects: [first] }, bears)).toBe("p1");
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
    expect(sick(recordControlChanges(state, own, [bears]), bears)).toBe(false);
  });
});
