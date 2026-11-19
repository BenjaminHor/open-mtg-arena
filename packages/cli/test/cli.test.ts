// The CLI's commands, run in-process through `run` (the same function `pnpm cli` calls), on files in a temp dir.

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/main.ts";

function cli(...args: string[]): string {
  const { output, code } = run(args);
  if (code !== 0) throw new Error(output);
  return output;
}

const tempFile = () => path.join(mkdtempSync(path.join(tmpdir(), "mtg-cli-")), "game.json");

describe("new, show, actions and do", () => {
  it("play a whole game to its end (the M1-17 acceptance)", () => {
    const file = tempFile();
    cli("new", "--scenario", "combat/lethal-attack-ends-the-game", "--out", file);
    expect(cli("show", file)).toMatch(/^Turn 3 · p1 · main1 · p1 has priority/);
    expect(cli("actions", file)).toMatch(/1\. pass/);
    cli("do", file, "all pass: until combat.declareAttackers");
    expect(cli("actions", file)).toMatch(/attack p2 with p1:Craw Wurm/);
    cli("do", file, "attack: [Craw Wurm]");
    cli("do", file, "all pass: until combat.damage");
    expect(cli("show", file)).toMatch(/game over: p1 wins \(p2: zeroLife\) on turn 3/);
    expect(cli("actions", file)).toBe("no actions: the game is over");
  });

  it("play a game from the prebuilt decks by action numbers alone, until a library runs out", () => {
    const file = tempFile();
    cli("new", "--decks", "red-aggro,green-stompy", "--seed", "7", "--first", "p1", "--out", file);
    // Always the first listed action: keep, pass, discard the first card, declare no one... until someone decks out.
    for (let i = 0; i < 5000 && !cli("show", file).includes("game over"); i++) cli("do", file, "1");
    expect(cli("show", file)).toMatch(/game over: p\d wins \(p\d: drewFromEmptyLibrary\)/);
  });

  it("concedes for a named player, though conceding isn't in the list", () => {
    const file = tempFile();
    cli("new", "--scenario", "casting/targets", "--out", file);
    expect(cli("actions", file)).not.toMatch(/concede/);
    expect(cli("do", file, "p2 concede: now")).toMatch(/game over: p1 wins \(p2: conceded\)/);
  });

  it("writes nothing when a step fails part way", () => {
    const file = tempFile();
    cli("new", "--scenario", "casting/targets", "--out", file);
    const before = readFileSync(file, "utf8");
    // The cast starts, then the target is illegal: the whole step is refused.
    expect(() => cli("do", file, "cast: Lightning Bolt, targets: [p2:Mountain]")).toThrow(/can't target/);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("shows only what a player may see with --as", () => {
    const file = tempFile();
    cli("new", "--decks", "red-aggro,green-stompy", "--seed", "3", "--first", "p1", "--out", file);
    const p2View = cli("show", file, "--as", "p2");
    const p1Hand = /p1 {2}life[^\n]*\n[^\n]*\n {4}hand: ([^\n]*)/.exec(cli("show", file))?.[1];
    expect(p1Hand).toBeDefined();
    expect(p2View).not.toContain(`hand: ${p1Hand}`);
    expect(p2View).toMatch(/p2 {2}life[^\n]*\n[^\n]*\n {4}hand: /);
  });
});
