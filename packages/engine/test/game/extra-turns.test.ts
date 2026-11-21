// Extra turns (CR 500.7) where no pool card reaches the case: several players given extra turns at once.

import { describe, expect, it } from "vitest";
import { addExtraTurns, nextTurn } from "../../src/game/extra-turns.ts";
import { midTurnState } from "../state/fixture.ts";

describe("extra turns (CR 500.7)", () => {
  it("adds several players' turns one at a time in APNAP order, so the last added (the nonactive player's) is first", () => {
    const state = midTurnState(); // p1's turn
    const added = addExtraTurns(state, ["p1", "p2"]);
    expect(added.state.extraTurns).toStrictEqual(["p2", "p1"]);
    expect(added.events).toStrictEqual([
      { type: "EXTRA_TURN_ADDED", player: "p1" },
      { type: "EXTRA_TURN_ADDED", player: "p2" },
    ]);
  });

  it("puts a new one before those still waiting", () => {
    const state = { ...midTurnState(), extraTurns: ["p2" as const] };
    expect(addExtraTurns(state, ["p1"]).state.extraTurns).toStrictEqual(["p1", "p2"]);
  });

  it("takes the next extra turn, else the player after the most recent regular turn's", () => {
    const state = { ...midTurnState(), extraTurns: ["p2" as const, "p1" as const], regularTurnPlayer: "p1" as const };
    const first = nextTurn(state);
    expect([first.player, first.extra, first.state.extraTurns]).toStrictEqual(["p2", true, ["p1"]]);
    const regular = nextTurn({ ...state, extraTurns: [] });
    expect([regular.player, regular.extra]).toStrictEqual(["p2", false]);
  });
});
