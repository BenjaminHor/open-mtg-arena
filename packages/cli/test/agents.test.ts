// The agents (`ai`, `auto`): reproducible, legal, limited.

import { describe, expect, it } from "vitest";
import { chooseAction } from "../src/agents.ts";
import { readGameFile } from "../src/game-file.ts";
import { nextRandom } from "../src/seeded-random.ts";
import { cli, deckGame, tempFile } from "./helpers.ts";

describe("agents", () => {
  it("are reproducible: the same seed makes the same game", () => {
    const a = deckGame("4");
    const b = deckGame("4");
    cli("auto", a, "--ai", "both", "--agent", "random", "--seed", "9");
    cli("auto", b, "--ai", "both", "--agent", "random", "--seed", "9");
    expect(readGameFile(a).actions).toStrictEqual(readGameFile(b).actions);
    expect(cli("show", a)).toMatch(/game over/);
  });

  it("first-legal games end, by decking", () => {
    const file = deckGame("2");
    expect(cli("auto", file, "--ai", "both", "--agent", "first-legal")).toMatch(
      /game over: p\d wins \(p\d: drewFromEmptyLibrary\)/,
    );
  });

  it("first-legal declares nothing rather than adding and taking back a lone creature that can't attack alone", () => {
    const file = tempFile();
    cli("new", "--scenario", "cards/m2-06c/jackal-familiar-take-back", "--out", file);
    expect(cli("auto", file, "--ai", "both", "--agent", "first-legal", "--max-turns", "3")).not.toMatch(/action limit/);
  });

  it("ai decides for the other players and stops when the named player must decide", () => {
    const file = deckGame("5");
    expect(cli("ai", file, "--until", "p2", "--agent", "first-legal")).toMatch(/your decision/);
    expect(cli("show", file)).toMatch(/pending: mulligan \(p2\)/);
  });

  it("stop at the action limit and say so", () => {
    const file = deckGame("6");
    expect(cli("auto", file, "--ai", "both", "--max-actions", "10")).toMatch(/the action limit was reached/);
    expect(readGameFile(file).actions).toHaveLength(10);
  });

  it("choose only among the legal actions, uniformly by the seed", () => {
    expect(() => chooseAction("random", {} as never, [], 1)).toThrow(/no legal actions/);
    const seen = new Set<number>();
    let seed = 1;
    for (let i = 0; i < 200; i++) {
      const r = nextRandom(seed);
      seen.add(Math.floor(r.value * 4));
      seed = r.seed;
    }
    expect([...seen].sort()).toStrictEqual([0, 1, 2, 3]);
  });
});
