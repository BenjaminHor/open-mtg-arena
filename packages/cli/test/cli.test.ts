// The CLI's commands, run in-process through `run` (the same function `pnpm cli` calls), on files in a temp dir.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cardDatabase } from "@mtg/cards";
import { describe, expect, it } from "vitest";
import { readGameFile, replay } from "../src/game-file.ts";
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

  // Hundreds of commands, each reading and writing the game file: about 2 s alone, more on CI beside the short fuzz.
  it("play a game from the prebuilt decks by action numbers alone, until a library runs out", {
    timeout: 30_000,
  }, () => {
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

  it("names the Aura an enchant choice is for (CR 303.4f, D-107)", () => {
    const file = tempFile();
    cli("new", "--scenario", "cards/m2-12d/open-the-vaults", "--out", file);
    cli("do", file, "cast: Open the Vaults, pay: auto");
    cli("do", file, "all pass: once");
    const state = readGameFile(file).state;
    const pending = state?.pending;
    expect(pending?.kind === "chooseCards" && pending.for !== null && state?.objects[pending.for]?.kind).toBe("card");
    expect(cli("actions", file)).toMatch(/1\. Pacifism enchants Grizzly Bears/);
    expect(cli("log", file, "--brief")).not.toMatch(/chooses/);
    cli("do", file, "choose: Hill Giant");
    expect(cli("log", file, "--brief")).toMatch(/p1 chooses p2:Hill Giant for Pacifism to enchant/);
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

  it("shows what Telepathy and Vampire Nocturnus reveal, the same to every player (D-122)", () => {
    const hand = tempFile();
    cli("new", "--scenario", "cards/m2-14f/telepathy-leaves", "--out", hand);
    expect(cli("show", hand, "--as", "p1")).toContain("    hand (revealed): Grizzly Bears, Naturalize");
    const top = tempFile();
    cli("new", "--scenario", "cards/m2-14f/vampire-nocturnus-black-top", "--out", top);
    for (const viewer of ["p1", "p2"])
      expect(cli("show", top, "--as", viewer)).toContain("    library top (revealed): Sign in Blood");
    expect(cli("show", top, "--as", "p1")).not.toMatch(/p2 [^\n]*\n[^\n]*\n {4}library top/);
  });
});

describe("the game file's actions are the truth (D-043)", () => {
  it("replaying the actions gives the cached state, and show is the same without the cache", () => {
    const cards = cardDatabase();
    const file = tempFile();
    cli("new", "--decks", "red-aggro,green-stompy", "--seed", "9", "--first", "p2", "--out", file);
    cli("auto", file, "--ai", "both", "--agent", "random", "--seed", "4", "--max-actions", "300");
    const game = readGameFile(file);
    expect(replay(game.setup, game.actions, cards).state).toStrictEqual(game.state);
    const shown = cli("show", file);
    writeFileSync(file, JSON.stringify({ ...game, state: undefined }));
    expect(cli("show", file)).toBe(shown);
  });
});

describe("show's layout", () => {
  it("matches testing.md's form exactly", () => {
    const file = tempFile();
    cli("new", "--scenario", "casting/targets", "--out", file);
    expect(cli("show", file)).toBe(
      [
        "Turn 3 · p1 · main1 · p1 has priority",
        "p2  life 20  hand 0  library 20  graveyard 0",
        "    battlefield: Mountain",
        "stack: (empty)",
        "p1  life 20  hand 3  library 20  graveyard 0",
        "    battlefield: Mountain, Mountain, Forest, Grizzly Bears 2/2",
        "    hand: Lightning Bolt, Giant Growth, Shock",
        "pending: priority (p1) — 7 legal actions; run `pnpm cli actions`",
      ].join("\n"),
    );
    // p2 doesn't learn how many actions p1 has (it would hint at p1's hand).
    expect(cli("show", file, "--as", "p2")).toMatch(/pending: priority \(p1\)$/);
  });
});

describe("mistakes are reported, not thrown", () => {
  it("says what's wrong, with exit code 1", () => {
    const file = tempFile();
    cli("new", "--scenario", "casting/targets", "--out", file);
    const fails = (...args: string[]) => {
      const { output, code } = run(args);
      expect(code, args.join(" ")).toBe(1);
      return output;
    };
    expect(fails("dance")).toMatch(/Unknown command/);
    expect(fails("do", file, "0")).toMatch(/no action 0/);
    expect(fails("do", file, "99")).toMatch(/no action 99/);
    expect(fails("show", file, "--as", "p3")).toMatch(/no player p3/);
    expect(fails("show", file, "extra")).toMatch(/takes one game file/);
    expect(fails("show", file, "--seed", "3")).toMatch(/Unknown option/);
    expect(fails("new", "--scenario", "casting/targets", "--seed", "3", "--out", file)).toMatch(/takes its setup/);
    expect(fails("new", "--decks", "red-aggro,green-stompy", "--seed", "0x10", "--out", file)).toMatch(/--seed/);
    cli("do", file, "p1 concede: now");
    expect(fails("do", file, "p2 concede: now")).toMatch(/the game is over/);
  });

  it("takes a step with or without braces and a player", () => {
    for (const step of [
      "{cast: Shock, targets: [p2], pay: auto}",
      "cast: Shock, targets: [p2], pay: auto",
      "{ p1 cast: Shock, targets: [p2], pay: auto }",
    ]) {
      const file = tempFile();
      cli("new", "--scenario", "casting/targets", "--out", file);
      expect(cli("do", file, step), step).toMatch(/stack: Shock → p2 \(p1\)/);
    }
  });
});
