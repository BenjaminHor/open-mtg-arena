// `log`, `inspect` and `replay`.

import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readGameFile } from "../src/game-file.ts";
import { cli, deckGame, tempFile } from "./helpers.ts";

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

  it("explains counters and rule modifiers too", () => {
    const file = tempFile();
    cli("new", "--scenario", "characteristics/counters", "--out", file);
    expect(cli("inspect", file, "p1:Grizzly Bears")).toMatch(/layer 7c: \+2\/\+2 from 2 \+1\/\+1 counters/);
    const ruled = tempFile();
    cli("new", "--scenario", "characteristics/rule-modifier", "--out", ruled);
    expect(cli("inspect", ruled, "p2:Gray Ogre")).toMatch(/layer 7c: \+2\/\+1 from rule modifier 1 of the game/);
  });

  it("explains a printed star by the ability that sets it (layer 7a)", () => {
    const file = tempFile();
    cli("new", "--scenario", "cards/m2-09b/nightmare", "--out", file);
    const inspected = cli("inspect", file, "p1:Nightmare");
    expect(inspected).toMatch(/printed: \*\/\*/);
    expect(inspected).toMatch(/layer 7a, its ability: 2\/2/);
  });

  it("explains a land made a creature by the effect that sets its power and toughness (layer 7b)", () => {
    const file = tempFile();
    cli("new", "--scenario", "cards/m2-09b2/awakener-druid", "--out", file);
    for (const step of ["cast: Awakener Druid, pay: auto", "all pass: once", "choose: p1:Forest", "all pass: once"])
      cli("do", file, step);
    const inspected = cli("inspect", file, "p1:Forest");
    expect(inspected).toMatch(/types: basic land creature — Forest Treefolk/);
    expect(inspected).toMatch(/printed: none/);
    expect(inspected).toMatch(/layer 7b, set by Awakener Druid: 4\/5/);
    expect(cli("log", file)).toMatch(/effect: p1:Forest becomes 4\/5, colors G, also creature, also Treefolk while/);
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
