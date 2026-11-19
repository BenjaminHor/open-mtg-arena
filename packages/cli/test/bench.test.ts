// `pnpm bench` (docs/testing.md, section 6) isn't part of `pnpm check`: timings on a shared CI runner would make it
// flaky. This only checks that its workloads still build from the golden games and run.

import { cardDatabase } from "@mtg/cards";
import { describe, expect, it } from "vitest";
import { referenceWork } from "../src/bench/timing.ts";
import { workloads } from "../src/bench/workloads.ts";

describe("the bench workloads", () => {
  it("build from the golden games, each with operations to count, and run", { timeout: 30_000 }, () => {
    const list = workloads(cardDatabase());
    expect(list.map((w) => w.name)).toEqual([
      "applyAction.emptyBoard",
      "applyAction.busyCombat",
      "applyAction.deepStack",
      "randomGame",
      "legalActions.busyBoard",
      "characteristics.busyBoard",
    ]);
    for (const w of list) {
      expect(w.count, w.name).toBeGreaterThan(0);
      w.run();
    }
    referenceWork();
  });
});
