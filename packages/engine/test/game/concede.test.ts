// Conceding (CR 104.3a): any time, by a player in the game, never listed by legalActions.

import { describe, expect, it } from "vitest";
import { applyAction, legalActions } from "../../src/index.ts";
import { TEST_CARDS } from "../support/cards.ts";
import { act, playerSetup, start } from "../support/game.ts";

function game() {
  return start({
    seed: 1,
    players: [playerSetup("p1", { library: ["forest"] }), playerSetup("p2", { library: ["forest"] })],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  });
}

describe("conceding (CR 104.3a)", () => {
  it("isn't listed as a legal action, though it's always allowed", () => {
    const g = game();
    for (const p of ["p1", "p2"] as const) {
      expect(legalActions(g.state, p, TEST_CARDS).some((a) => a.type === "CONCEDE")).toBe(false);
    }
    expect(act(g, { type: "CONCEDE", player: "p2" }).state.result).toMatchObject({ winner: "p1" });
  });

  it("is refused for someone not in the game, and once the game is over", () => {
    const g = game();
    const stranger = applyAction(g.state, { type: "CONCEDE", player: "p3" }, TEST_CARDS);
    expect(stranger).toMatchObject({ ok: false, error: { code: "illegalAction" } });
    const over = act(g, { type: "CONCEDE", player: "p1" });
    const again = applyAction(over.state, { type: "CONCEDE", player: "p2" }, TEST_CARDS);
    expect(again).toMatchObject({ ok: false, error: { code: "gameOver" } });
  });
});
