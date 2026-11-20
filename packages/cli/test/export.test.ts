// `export --scenario`: a game written as a scenario that replays it exactly.

import { cardDatabase } from "@mtg/cards";
import { runScenario } from "@mtg/scenarios";
import { describe, expect, it } from "vitest";
import { readGameFile } from "../src/game-file.ts";
import { cli, deckGame, tempFile } from "./helpers.ts";

describe("export --scenario", () => {
  it("writes a scenario that replays the game exactly, ending with where the game ended up", () => {
    const cards = cardDatabase();
    // Six whole random games (each checked against every invariant at every state, so this takes a few seconds).
    for (let seed = 1; seed <= 6; seed++) {
      const file = deckGame(String(seed));
      cli("auto", file, "--ai", "both", "--agent", "random", "--seed", String(seed));
      const yaml = cli("export", file, "--scenario", "--name", "a random game", "--rules", "CR 100.1");
      expect(yaml).toMatch(/winner: p\d|winner: draw/);
      // Not only does it pass: the scenario reaches the very same state, object for object.
      let last: unknown = null;
      const result = runScenario(yaml, cards, (state) => {
        last = state;
        return [];
      });
      expect(result.problems, `seed ${seed}`).toStrictEqual([]);
      expect(last, `seed ${seed}`).toStrictEqual(readGameFile(file).state);
    }
  }, 60_000);

  it("names a spell on the stack as a target, so games with counterspells export too", () => {
    const cards = cardDatabase();
    // A golden game in which Negate, Cancel and Essence Scatter target spells.
    const golden = new URL("../../engine/test/golden/blue-green-vs-white-red-104.json", import.meta.url).pathname;
    const yaml = cli("export", golden, "--scenario", "--name", "counterspells", "--rules", "CR 100.1");
    expect(runScenario(yaml, cards).problems).toStrictEqual([]);
  }, 60_000);

  it("refuses a game that stops part way through a declaration", () => {
    const file = tempFile();
    cli("new", "--scenario", "combat/blocked-creatures-trade", "--out", file);
    cli("do", file, "all pass: until combat.declareAttackers");
    cli("do", file, "1"); // declare one attacker, not finished
    expect(() => cli("export", file, "--scenario")).toThrow(/part way through a declaration/);
  });
});
