import { describe, expect, it } from "vitest";
import { plainJsonProblems } from "../support/plain-json.ts";
import { midTurnState } from "./fixture.ts";

// CLAUDE.md, hard invariants: GameState is plain JSON, so JSON.parse(JSON.stringify(state)) gives an equal state.
// toStrictEqual (not toEqual) is what makes this a real check: toEqual ignores undefined properties.

describe("GameState as plain JSON", () => {
  it("survives a JSON round trip unchanged", () => {
    const state = midTurnState();
    expect(JSON.parse(JSON.stringify(state))).toStrictEqual(state);
  });

  it("contains only plain JSON values", () => {
    expect(plainJsonProblems(midTurnState())).toStrictEqual([]);
  });

  it("would fail the round trip if a field were undefined", () => {
    const state = { ...midTurnState(), result: undefined };
    expect(JSON.parse(JSON.stringify(state))).not.toStrictEqual(state);
    expect(plainJsonProblems(state)).toStrictEqual(["state.result is undefined"]);
  });
});
