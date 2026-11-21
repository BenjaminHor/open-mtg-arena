// Matching trigger conditions where the pool can't show it: one creature blocking two attackers (only Palace Guard
// can block more than one, and it has no block trigger).

import { describe, expect, it } from "vitest";
import type { GameState, ObjectId } from "../../src/index.ts";
import { matches } from "../../src/triggers/match-event.ts";
import { TEST_CARDS } from "../support/cards.ts";

describe("whenever this creature blocks a creature (CR 509.3b)", () => {
  it("triggers once for each attacking creature it blocks, that creature being each one", () => {
    const [wall, other, a1, a2] = ["o1", "o2", "o3", "o4"] as ObjectId[];
    const blocks = [
      { blocker: wall as ObjectId, attacker: a1 as ObjectId },
      { blocker: wall as ObjectId, attacker: a2 as ObjectId },
      { blocker: other as ObjectId, attacker: a1 as ObjectId },
    ];
    const found = matches(
      {} as GameState,
      wall as ObjectId,
      { kind: "selfBlocks" },
      { type: "BLOCKERS_DECLARED", player: "p2", blocks },
      TEST_CARDS,
    );
    expect(found.map((t) => t.object)).toStrictEqual([a1, a2]);
  });
});
