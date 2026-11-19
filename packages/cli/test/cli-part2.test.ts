// The CLI's second half: agents, the log, inspect, export and replay.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cardDatabase } from "@mtg/cards";
import { runScenario } from "@mtg/scenarios";
import { describe, expect, it } from "vitest";
import { chooseAction, nextRandom } from "../src/agents.ts";
import { readGameFile } from "../src/game-file.ts";
import { run } from "../src/main.ts";

function cli(...args: string[]): string {
  const { output, code } = run(args);
  if (code !== 0) throw new Error(output);
  return output;
}

const tempFile = () => path.join(mkdtempSync(path.join(tmpdir(), "mtg-cli-")), "game.json");

function deckGame(seed: string): string {
  const file = tempFile();
  cli("new", "--decks", "red-aggro,green-stompy", "--seed", seed, "--first", "p1", "--out", file);
  return file;
}

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

describe("export --scenario", () => {
  it("writes a scenario that passes, ending with where the game ended up", () => {
    const cards = cardDatabase();
    for (const seed of ["11", "12"]) {
      const file = deckGame(seed);
      cli("auto", file, "--ai", "both", "--agent", "random", "--seed", seed);
      const yaml = cli("export", file, "--scenario", "--name", "a random game", "--rules", "CR 100.1");
      expect(yaml).toMatch(/winner: p\d|winner: draw/);
      expect(runScenario(yaml, cards).problems).toStrictEqual([]);
    }
  });

  it("refuses a game that stops part way through a declaration", () => {
    const file = tempFile();
    cli("new", "--scenario", "combat/blocked-creatures-trade", "--out", file);
    cli("do", file, "all pass: until combat.declareAttackers");
    cli("do", file, "1"); // declare one attacker, not finished
    expect(() => cli("export", file, "--scenario")).toThrow(/part way through a declaration/);
  });
});

describe("log, inspect and replay", () => {
  it("logs the events by turn, and inspect explains power and toughness", () => {
    const file = tempFile();
    cli("new", "--scenario", "characteristics/two-pumps-stack", "--out", file);
    cli("do", file, "cast: Giant Growth, targets: [p1:Grizzly Bears], pay: auto");
    cli("do", file, "all pass: once");
    expect(cli("log", file)).toMatch(/T3 effect: p1:Grizzly Bears \+3\/\+3 until end of turn/);
    const inspected = cli("inspect", file, "p1:Grizzly Bears");
    expect(inspected).toMatch(/power\/toughness: 5\/5/);
    expect(inspected).toMatch(/printed: 2\/2/);
    expect(inspected).toMatch(/layer 7c: \+3\/\+3 until end of turn, from a spell or ability that's gone/);
  });

  it("replays from the setup, and warns when the cached state differs", () => {
    const file = deckGame("8");
    cli("auto", file, "--ai", "both", "--max-actions", "50");
    expect(cli("replay", file, "--step", "0")).toMatch(/replayed 0 of 50 actions\nBefore the first turn/);
    expect(cli("replay", file)).not.toMatch(/warning/);
    const game = readGameFile(file);
    writeFileSync(file, JSON.stringify({ ...game, state: { ...game.state, nextId: 99999 } }));
    expect(cli("replay", file)).toMatch(/warning: the cached state differs/);
    expect(readFileSync(file, "utf8")).toContain("99999"); // replay changes nothing
  });
});

describe("the log's turn numbers", () => {
  it("put the end of a turn's effects in that turn, though the same action begins the next", () => {
    const file = tempFile();
    cli("new", "--scenario", "characteristics/pump-wears-off", "--out", file);
    cli("do", file, "cast: Giant Growth, targets: [p1:Grizzly Bears], pay: auto");
    cli("do", file, "all pass: until upkeep");
    const log = cli("log", file);
    expect(log).toMatch(/T3 effect ends: p1:Grizzly Bears \+3\/\+3/);
    expect(log).toMatch(/T4 turn 4 begins \(p2\)/);
  });
});
