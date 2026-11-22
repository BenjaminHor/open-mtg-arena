// Who copies a spell for Hive Mind ("each other player copies that spell"), and in what order. With two players only
// one player copies, so the order shows only in a hand-built game with three (createGame takes two so far).

import { describe, expect, it } from "vitest";
import { copySpell } from "../../src/game/copy-spell.ts";
import type { EffectContext, GameState, PlayerId } from "../../src/index.ts";
import { midTurnState } from "../state/fixture.ts";

// Lightning Bolt (o10) is on the stack in the fixture.
function copiers(active: PlayerId, caster: PlayerId): PlayerId[] {
  const base = midTurnState();
  const state: GameState = { ...base, turnOrder: ["p1", "p2", "p3"], turn: { ...base.turn!, activePlayer: active } };
  const context: EffectContext = {
    self: "o11",
    controller: "p2",
    targets: [],
    division: [],
    x: null,
    trigger: { player: caster, object: "o10", amount: null },
  };
  const effect = { op: "copySpell", of: "triggeringObject", by: "eachOtherPlayer", newTargets: "may" } as const;
  const { state: after } = copySpell(state, effect, context, {});
  return after.work.flatMap((item) => (item.kind === "copySpellFor" ? [item.player] : []));
}

describe("Hive Mind's copies (its ruling)", () => {
  it("starts with the active player, then each other player in turn order, skipping the caster", () => {
    expect(copiers("p1", "p2")).toStrictEqual(["p1", "p3"]);
    expect(copiers("p3", "p1")).toStrictEqual(["p3", "p2"]);
  });

  it("starts with the player after the active player when the active player cast the spell", () => {
    expect(copiers("p1", "p1")).toStrictEqual(["p2", "p3"]);
  });
});
