// Laying out a row between two edges (board-model/spread.ts).

import { describe, expect, it } from "vitest";
import { spread } from "../src/board-model/spread.ts";

describe("spread", () => {
  it("packs a row that fits against the asked edge, or centres it", () => {
    expect(spread([10, 10], 0, 100, 5, "start")).toEqual([0, 15]);
    expect(spread([10, 10], 0, 100, 5, "end")).toEqual([75, 90]);
    expect(spread([10, 10], 0, 100, 5, "centre")).toEqual([37.5, 52.5]);
  });

  it("overlaps a row that doesn't fit evenly, from edge to edge", () => {
    expect(spread([40, 40, 40], 0, 100, 5, "centre")).toEqual([0, 30, 60]);
  });

  it("lays out nothing for an empty row", () => {
    expect(spread([], 0, 100, 5, "start")).toEqual([]);
  });
});
