// Putting a card onto the battlefield with characteristics it enters with (Rise from the Grave): what no scenario can
// show, the order of the timestamps.

import { describe, expect, it } from "vitest";
import { putTargetOntoBattlefield } from "../../src/effects/becomes.ts";
import type { EffectContext, ObjectId } from "../../src/index.ts";
import { BEARS, FOREST, TEST_CARDS } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

describe("putTargetOntoBattlefield", () => {
  it("makes the effect with the move, on the new object, its timestamp after the object's (CR 613.7n, 611.2e)", () => {
    const state = start({
      seed: 1,
      players: [playerSetup("p1", { library: [FOREST] }), playerSetup("p2", { library: [FOREST], graveyard: [BEARS] })],
      opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
      ruleModifiers: [],
    }).state;
    const card = state.zones.players.p2?.graveyard[0];
    if (card === undefined) throw new Error("no card in p2's graveyard");
    const context: EffectContext = {
      self: card,
      controller: "p1",
      targets: [[{ kind: "object", object: card }]],
      division: [],
      x: null,
      trigger: null,
    };
    const is = { addTypes: [], addSubtypes: ["Zombie"], colors: { add: ["B" as const] } };
    const after = putTargetOntoBattlefield(
      state,
      { op: "putTargetOntoBattlefield", target: 0, is },
      context,
      TEST_CARDS,
    );
    const [entered] = after.state.zones.battlefield as [ObjectId];
    const obj = after.state.objects[entered];
    const effect = after.state.effects[0];
    expect(obj?.kind === "card" && obj.baseController).toBe("p1");
    expect(effect?.affected).toStrictEqual([entered]);
    expect(effect?.duration).toBe("endOfGame");
    expect(obj?.kind === "card" && effect !== undefined && effect.timestamp > obj.timestamp).toBe(true);
  });
});
