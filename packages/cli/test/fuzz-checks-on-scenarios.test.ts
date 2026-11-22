// The fuzz checks a random game rarely reaches: Warp World costs eight mana, and Clone and Mirror of Fate need a board
// set up for them. So the checks that need only the state after each action (a view leaking nothing, D-044; the layer
// cache agreeing with a fresh pass; the engine's invariants) run on every state of those cards' scenarios too.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cardDatabase } from "@mtg/cards";
import { invariantProblems, runScenario } from "@mtg/scenarios";
import { describe, expect, it } from "vitest";
import { heldBackTopsHidden, layersMatchFreshPass, viewsLeakNothing } from "../src/fuzz/checks.ts";

const SCENARIOS = join(import.meta.dirname, "../../engine/test/scenarios/cards");
const FOLDERS = ["m2-14i", "m2-14j", "m2-14k"];

describe("the fuzz checks hold on every state of the scenarios a random game rarely reaches", () => {
  const cards = cardDatabase();
  for (const folder of FOLDERS) {
    for (const file of readdirSync(join(SCENARIOS, folder)).filter((f) => f.endsWith(".yaml"))) {
      it(`${folder}/${file}`, () => {
        const yaml = readFileSync(join(SCENARIOS, folder, file), "utf8");
        const result = runScenario(yaml, cards, (state, _cards, events, before) => [
          ...invariantProblems(state, cards),
          ...viewsLeakNothing(before, state, events, cards),
          ...heldBackTopsHidden(state, state, [], cards),
          ...layersMatchFreshPass(state, state, [], cards),
        ]);
        expect(result.problems).toStrictEqual([]);
      });
    }
  }
});
