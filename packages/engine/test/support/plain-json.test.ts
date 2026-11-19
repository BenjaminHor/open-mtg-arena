import { describe, expect, it } from "vitest";
import { plainJsonProblems } from "./plain-json.ts";

describe("plainJsonProblems", () => {
  it("accepts plain JSON data", () => {
    expect(plainJsonProblems({ a: [1, "x", null, true, { b: [] }] })).toStrictEqual([]);
  });

  it("reports each kind of non-JSON value with its path", () => {
    const bad = {
      u: undefined,
      n: Number.NaN,
      inf: Number.POSITIVE_INFINITY,
      f: () => 1,
      big: 1n,
      map: new Map(),
      set: new Set(),
      date: new Date(0),
      list: [1, undefined],
    };
    expect(plainJsonProblems(bad)).toStrictEqual([
      "state.u is undefined",
      "state.n is NaN",
      "state.inf is Infinity",
      "state.f is a function",
      "state.big is a bigint",
      "state.map is a Map, not a plain object",
      "state.set is a Set, not a plain object",
      "state.date is a Date, not a plain object",
      "state.list[1] is undefined",
    ]);
  });
});
