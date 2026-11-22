// `brief` (M2-15f) tells a player only what they may know. Two worlds that differ only in what's hidden from the viewer
// (the cards in other players' hands and every library, and their order) must give the same brief, text and JSON: the
// same test the fuzzer runs on `playerView` (`viewsLeakNothing`), here on what the CLI prints. It runs on every state
// of scenarios with hidden cards in play: searches, reveals, copies, shuffles.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cardDatabase } from "@mtg/cards";
import type { GameState, ObjectId } from "@mtg/engine";
import { runScenario } from "@mtg/scenarios";
import { describe, expect, it } from "vitest";
import { briefOf } from "../src/brief/brief.ts";
import { briefText } from "../src/brief/brief-text.ts";
import { scrambleHidden } from "../src/fuzz/checks.ts";
import { currentState, readGameFile } from "../src/game-file.ts";
import { run } from "../src/main.ts";
import { cli, tempFile } from "./helpers.ts";

const SCENARIOS = join(import.meta.dirname, "../../engine/test/scenarios/cards");
const FOLDERS = ["m2-05b2", "m2-14f", "m2-14i", "m2-14j", "m2-14k"];

function leaks(state: GameState): string[] {
  const cards = cardDatabase();
  const problems: string[] = [];
  for (const viewer of state.turnOrder) {
    const real = briefOf(state, viewer, [], cards);
    const other = briefOf(scrambleHidden(state, viewer, cards), viewer, [], cards);
    if (JSON.stringify(real) !== JSON.stringify(other)) problems.push(`${viewer}'s brief changes with hidden cards`);
    if (briefText(real, true) !== briefText(other, true)) problems.push(`${viewer}'s brief text changes`);
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
