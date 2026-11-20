// The compact action format (D-082): actions survive being written as lines and read back, every kind of them.

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
    };
    const lines = actionLines([
      ...Object.values(answers).map((answer): Action => ({ type: "ANSWER", decisionId: "d1", player: "p1", answer })),
      { type: "CONCEDE", player: "p2" },
    ]);
    expect(lines).toContain("payMana B1 R2 C1");
    expect(lines).toContain("chooseTarget o14");
    expect(lines).toContain("concede p2");
    // Each line read back as answering p1's decision d1: the words alone, not the rules, so no game is needed.
    const back = lines.map((line) => actionFromLine(line, { decisionId: "d1", player: "p1" }));
    expect(back).toStrictEqual([
      ...Object.values(answers).map((answer) => ({ type: "ANSWER", decisionId: "d1", player: "p1", answer })),
      { type: "CONCEDE", player: "p2" },
    ]);
  });

  it("counts the lines left once the game has ended, rather than dropping them in silence", () => {
    const setup = deckGameSetup([DECKS["red-aggro"], DECKS["green-stompy"]] as DeckList[], 3, null);
    const actions = playRecipe({ setup, agent: "random", agentSeed: 3, maxTurns: 200 }, cards);
    const back = actionsFromLines(setup, [...actionLines(actions), "cast o99", "pass 7"], cards);
    expect(back.actions).toStrictEqual(actions);
    expect(back.unread).toBe(2);
  });

  it("refuses a line it can't read", () => {
    const setup = deckGameSetup([DECKS["red-aggro"], DECKS["green-stompy"]] as DeckList[], 3, null);
    expect(() => actionsFromLines(setup, ["pass x"], cards)).toThrow('"x" isn\'t a number of passes');
    expect(() => actionsFromLines(setup, ["teleport o1"], cards)).toThrow('no action "teleport"');
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
