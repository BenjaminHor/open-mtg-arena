// `brief` (M2-15f) tells a player only what they may know. Two worlds that differ only in what's hidden from the viewer
// (the cards in other players' hands and every library, and their order) must give the same brief, text and JSON: the
// same test the fuzzer runs on `playerView` (`viewsLeakNothing`), here on what the CLI prints. It runs on every state
// of scenarios with hidden cards in play: searches, reveals, copies, shuffles.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cardDatabase } from "@mtg/cards";
import { type GameState, type ObjectId, seatView } from "@mtg/engine";
import { runScenario } from "@mtg/scenarios";
import { describe, expect, it } from "vitest";
import { briefOf } from "../src/brief/brief.ts";
import { briefText } from "../src/brief/brief-text.ts";
import { scrambleHidden } from "../src/fuzz/checks.ts";
import { currentState, readGameFile } from "../src/game-file.ts";
import { run } from "../src/main.ts";
import { cli, tempFile } from "./helpers.ts";

const SCENARIOS = join(import.meta.dirname, "../../engine/test/scenarios/cards");
// Every folder with hidden cards in play: searches and reveals, Telepathy and Vampire Nocturnus, Djinn of Wishes,
// spell copies, Clone, Mirror of Fate, Warp World.
const FOLDERS = ["m2-05b2", "m2-14f", "m2-14g", "m2-14h", "m2-14i", "m2-14j", "m2-14k"];

function leaks(state: GameState): string[] {
  const cards = cardDatabase();
  const problems: string[] = [];
  for (const viewer of state.turnOrder) {
    const real = briefOf(state, viewer, [], cards);
    const other = briefOf(scrambleHidden(state, viewer, cards), viewer, [], cards);
    if (JSON.stringify(real) !== JSON.stringify(other)) problems.push(`${viewer}'s brief changes with hidden cards`);
    if (briefText(real, true) !== briefText(other, true)) problems.push(`${viewer}'s brief text changes`);
    // What the seat is shown, which the brief, the UI and every AI read (D-135, D-137, D-144).
    const scrambled = scrambleHidden(state, viewer, cards);
    const shown = JSON.stringify(seatView(state, viewer, cards));
    if (shown !== JSON.stringify(seatView(scrambled, viewer, cards))) problems.push(`${viewer}'s seat view changes`);
  }
  return problems;
}

describe("a brief shows nothing hidden from its player", () => {
  const cards = cardDatabase();
  for (const folder of FOLDERS) {
    for (const file of readdirSync(join(SCENARIOS, folder)).filter((f) => f.endsWith(".yaml"))) {
      it(`${folder}/${file}`, () => {
        const yaml = readFileSync(join(SCENARIOS, folder, file), "utf8");
        const result = runScenario(yaml, cards, (state) => leaks(state));
        expect(result.problems).toStrictEqual([]);
      });
    }
  }
});

describe("the brief command", () => {
  it("shows the viewer's board in detail, what they saw happen, and only their own actions", () => {
    const file = tempFile();
    cli("new", "--scenario", "combat/lethal-attack-ends-the-game", "--out", file);
    const mine = cli("brief", file, "--as", "p1", "--text");
    expect(mine).toMatch(/^Turn 3 · p1's turn · main1 \(next: combat.beginning\)\nYou are p1\. You decide: priority\./);
    expect(mine).toMatch(/Craw Wurm 6\/4 · Creature — Wurm \[p1:Craw Wurm\]/);
    expect(mine).toMatch(/your actions: `pnpm cli do <file> <n>`[^\n]*\n[^\n]*\n {2}1\. pass/);
    // The other player is told whom they wait for, never the decision's options.
    const theirs = cli("brief", file, "--as", "p2");
    expect(theirs).toContain("You are p2. Waiting for p1 (priority).");
    expect(theirs).not.toContain("your actions");
    // The JSON is the same data: a program reads it.
    const json = JSON.parse(cli("brief", file, "--as", "p1", "--json"));
    expect(json.format).toBe("open-mtg-arena brief");
    expect(json.players[0].battlefield[0]).toMatchObject({ name: "Craw Wurm", power: 6, toughness: 4 });
    expect(json.actions[0]).toMatchObject({ n: 1, text: "pass", cost: null, payable: null });
  });

  it("gives each action its cost, whether the mana is there, and its legal targets", () => {
    const file = tempFile();
    cli("new", "--scenario", "effects/bolt-a-creature", "--out", file);
    const json = JSON.parse(cli("brief", file, "--as", "p1", "--json"));
    expect(json.actions[1]).toStrictEqual({
      n: 2,
      text: "cast Lightning Bolt",
      cost: "{R}",
      payable: true,
      targets: [["p2:Giant Spider", "p2:Grizzly Bears", "p1", "p2"]],
      mana: false,
    });
    expect(json.actions[2]).toMatchObject({ n: 3, mana: true });
    const text = cli("brief", file, "--as", "p1");
    expect(text).toContain("  2. cast Lightning Bolt — {R}\n       targets: p2:Giant Spider, p2:Grizzly Bears, p1, p2");
    expect(text).toContain("  mana abilities: 3. activate p1:Mountain ({T}: add mana)");
    // With the Mountain tapped and no mana in the pool, the hint says so; casting is still legal (CR 118.6, 601.2h).
    const state = currentState(readGameFile(file), cardDatabase());
    const mountain = state.zones.battlefield.find((id) => {
      const obj = state.objects[id];
      return obj?.kind === "card" && obj.owner === "p1";
    }) as ObjectId;
    const tapped = {
      ...state,
      objects: { ...state.objects, [mountain]: { ...state.objects[mountain], tapped: true } },
    };
    const bolt = briefOf(tapped as GameState, "p1", [], cardDatabase()).actions[1];
    expect(bolt).toMatchObject({ text: "cast Lightning Bolt", payable: false });
    expect(briefText(briefOf(tapped as GameState, "p1", [], cardDatabase()), false)).toContain(
      "cast Lightning Bolt — {R} (not enough mana now)",
    );
  });

  it("is one player's: --as is required and must name a player", () => {
    const file = tempFile();
    cli("new", "--scenario", "combat/lethal-attack-ends-the-game", "--out", file);
    expect(run(["brief", file]).output).toBe("brief needs --as <player>");
    expect(run(["brief", file, "--as", "p9"]).output).toBe("--as: no player p9");
  });
});

describe("since you last acted (the events each player saw)", () => {
  it("starts at the viewer's own last action, names only what they saw, folds draws and repeats", () => {
    const file = tempFile();
    cli("new", "--decks", "white-soldiers,red-green-beats", "--seed", "1", "--first", "p1", "--out", file);
    cli("do", file, "2"); // p1 mulligans
    cli("do", file, "1"); // p2 keeps
    const recent = (as: string) => JSON.parse(cli("brief", file, "--as", as, "--json")).recent as string[];
    // p1's hand goes back and seven new cards are drawn: p1 sees which; a draw is one line, repeats are counted.
    const mine = recent("p1");
    expect(mine[0]).toBe("T0 p1 mulligans");
    expect(mine).not.toContain("T0 p1 goes first"); // before p1's last action
    expect(mine).toContain("T0 p1 draws Plains (x5)");
    expect(mine.some((l) => l.includes("from p1's library to p1's hand"))).toBe(false);
    // p2 sees the same moves without a card named (CR 401.2, 402.3).
    expect(recent("p2")).toStrictEqual([
      "T0 p2 keeps",
      "T0 a card moves from p1's hand to p1's library (x7)",
      "T0 p1 shuffles their library",
      "T0 p1 draws a card (x7)",
    ]);
  });

  it("is everything since the game began for a player who hasn't acted yet", () => {
    const file = tempFile();
    cli("new", "--decks", "white-soldiers,red-green-beats", "--seed", "1", "--first", "p1", "--out", file);
    const lines = JSON.parse(cli("brief", file, "--as", "p2", "--json")).recent as string[];
    expect(lines.slice(0, 4)).toStrictEqual([
      "T0 p1 goes first",
      "T0 p1 shuffles their library",
      "T0 p2 shuffles their library",
      "T0 p1 draws a card (x7)",
    ]);
    expect(lines).toContain("T0 p2 draws Garruk Wildspeaker");
  });
});

describe("action costs", () => {
  it("names what a sacrifice cost takes: Siege-Gang Commander's Goblin", () => {
    const file = tempFile();
    cli("new", "--scenario", "cards/m2-11b/siege-gang-sacrifice-itself", "--out", file);
    expect(cli("brief", file, "--as", "p1")).toMatch(/Sacrifice a Goblin/);
  });
});

describe("the next step", () => {
  it("passes over a skipped step: the first player's first draw step (CR 103.8a, 500.11)", () => {
    const file = tempFile();
    cli("new", "--decks", "white-soldiers,red-green-beats", "--seed", "1", "--first", "p1", "--out", file);
    cli("do", file, "1"); // p1 keeps
    cli("do", file, "1"); // p2 keeps
    expect(cli("brief", file, "--as", "p1")).toMatch(/^Turn 1 · p1's turn · upkeep \(next: main1\)/);
  });
});
