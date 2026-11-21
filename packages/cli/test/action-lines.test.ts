// The compact action format (D-082, D-083): actions survive being written as lines and read back, every kind of them.

import { cardDatabase, DECKS, type DeckList } from "@mtg/cards";
import type { Action, Answer } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { actionFromLine, actionLines, actionsFromLines } from "../src/action-lines.ts";
import { deckGameSetup } from "../src/deck-setup.ts";
import { playRecipe } from "../src/golden.ts";
import { setupFromNames, setupWithNames } from "../src/setup-names.ts";

const cards = cardDatabase();

describe("action lines", () => {
  it("give back exactly the actions agents took, with their decision ids and players, for whole games", () => {
    for (const [decks, seed] of [
      [[DECKS["red-green-beats"], DECKS["blue-black-control"]], 7],
      [[DECKS["red-aggro"], DECKS["green-stompy"]], 3],
    ] as const) {
      const setup = deckGameSetup(decks as unknown as DeckList[], seed, null);
      const actions = playRecipe({ setup, agent: "by-kind", agentSeed: seed, maxTurns: 30 }, cards);
      const back = actionsFromLines(setup, actionLines(actions), cards);
      expect(back).toStrictEqual({ actions, unread: 0 });
    }
  });

  it("write every kind of answer, and a concession, so they read back the same", () => {
    // One of each kind; the Record makes a new answer kind fail to compile until it's added here.
    const answers: Record<Answer["kind"], Answer> = {
      chooseStartingPlayer: { kind: "chooseStartingPlayer", player: "p2" },
      mulligan: { kind: "mulligan", choice: "keep" },
      mulliganBottom: { kind: "mulliganBottom", object: "o12" },
      discardToHandSize: { kind: "discardToHandSize", object: "o13" },
      chooseTarget: { kind: "chooseTarget", target: { kind: "object", object: "o14" } },
      announceX: { kind: "announceX", value: 3 },
      chooseTargetCount: { kind: "chooseTargetCount", count: 2 },
      divide: { kind: "divide", amount: 2 },
      chooseSacrifice: { kind: "chooseSacrifice", object: "o15" },
      payMana: { kind: "payMana", payment: { W: 0, U: 0, B: 1, R: 2, G: 0, C: 1 } },
      cancelCast: { kind: "cancelCast" },
      declareAttacker: { kind: "declareAttacker", attack: { attacker: "o16", defender: "p2" } },
      declareBlocker: { kind: "declareBlocker", block: { blocker: "o17", attacker: "o16" } },
      finishDeclaring: { kind: "finishDeclaring" },
      takeBack: { kind: "takeBack" },
      orderTrigger: { kind: "orderTrigger", index: 1 },
      assignDamage: { kind: "assignDamage", amount: 4 },
      chooseCard: { kind: "chooseCard", option: 2 },
      finishChoosing: { kind: "finishChoosing" },
      chooseYesNo: { kind: "chooseYesNo", yes: false },
      chooseReplacement: { kind: "chooseReplacement", option: 1 },
    };
    // An attack on a planeswalker names it last (CR 508.1b).
    const onWalker: Answer = { kind: "declareAttacker", attack: { attacker: "o16", defender: "p2", attacked: "o18" } };
    const all = [...Object.values(answers), onWalker];
    const lines = actionLines([
      ...all.map((answer): Action => ({ type: "ANSWER", decisionId: "d1", player: "p1", answer })),
      { type: "CONCEDE", player: "p2" },
    ]);
    expect(lines).toContain("p1 declareAttacker o16 p2 o18");
    expect(lines).toContain("p1 payMana B1 R2 C1");
    expect(lines).toContain("p1 chooseTarget o14");
    expect(lines).toContain("p2 concede");
    // Each line read back as answering p1's decision d1: the words alone, not the rules, so no game is needed.
    const back = lines.map((line) => actionFromLine(line, "d1"));
    expect(back).toStrictEqual([
      ...all.map((answer) => ({ type: "ANSWER", decisionId: "d1", player: "p1", answer })),
      { type: "CONCEDE", player: "p2" },
    ]);
  });

  it("counts the lines left once the game has ended, rather than dropping them in silence", () => {
    const setup = deckGameSetup([DECKS["red-aggro"], DECKS["green-stompy"]] as DeckList[], 3, null);
    const actions = playRecipe({ setup, agent: "random", agentSeed: 3, maxTurns: 200 }, cards);
    const back = actionsFromLines(setup, [...actionLines(actions), "p1 cast o99", "pass p1 p2"], cards);
    expect(back.actions).toStrictEqual(actions);
    expect(back.unread).toBe(2);
  });

  it("refuses a line it can't read", () => {
    const setup = deckGameSetup([DECKS["red-aggro"], DECKS["green-stompy"]] as DeckList[], 3, null);
    expect(() => actionsFromLines(setup, ["pass x"], cards)).toThrow('"x" isn\'t a player');
    expect(() => actionsFromLines(setup, ["p1 teleport o1"], cards)).toThrow('no action "teleport"');
    expect(() => actionsFromLines(setup, ["pass"], cards)).toThrow("a pass names no player");
    expect(() => actionsFromLines(setup, ["p1 pass"], cards)).toThrow('write passes as "pass p1 p2 ..."');
  });

  it("stops at a line whose player isn't the one being asked: the engine refuses it, so who acts is checked (D-083)", () => {
    const setup = deckGameSetup([DECKS["red-aggro"], DECKS["green-stompy"]] as DeckList[], 3, null);
    const actions = playRecipe({ setup, agent: "by-kind", agentSeed: 3, maxTurns: 3 }, cards);
    const lines = actionLines(actions);
    // The first decision is the starting player's choice, asked of one player: give it to the other.
    const [first = "", ...rest] = lines;
    const other = first.startsWith("p1 ") ? `p2${first.slice(2)}` : `p1${first.slice(2)}`;
    const back = actionsFromLines(setup, [other, ...rest], cards);
    expect(back.actions).toHaveLength(1);
    expect(back.actions.at(-1)?.player).toBe(other.slice(0, 2));
    expect(back.unread).toBe(rest.length);
  });

  it("stops at a pass by the player who doesn't have priority (CR 117.3d)", () => {
    const setup = deckGameSetup([DECKS["red-aggro"], DECKS["green-stompy"]] as DeckList[], 3, null);
    const actions = playRecipe({ setup, agent: "by-kind", agentSeed: 3, maxTurns: 3 }, cards);
    const lines = actionLines(actions);
    const at = lines.findIndex((l) => /^pass p\d+ p\d+/.test(l));
    const run = (lines[at] ?? "").split(" ");
    // The run's second pass given to the player who passed first: they don't have priority then.
    const swapped = ["pass", run[1], run[1], ...run.slice(3)].join(" ");
    const back = actionsFromLines(setup, [...lines.slice(0, at), swapped, ...lines.slice(at + 1)], cards);
    expect(back.actions.at(-1)).toMatchObject({ type: "PASS_PRIORITY", player: run[1] });
    expect(back.unread).toBe(lines.length - at - 1);
  });
});

describe("setup names", () => {
  it("name every card and give back the same setup", () => {
    const setup = deckGameSetup([DECKS["red-green-beats"], DECKS["blue-black-control"]] as DeckList[], 4, null);
    const named = setupWithNames(setup, cards);
    expect(named.players[0]?.library).toContain("Lightning Bolt");
    expect(setupFromNames(named, cards)).toStrictEqual(setup);
  });
});
