// What each prompt says (interaction/prompt-text.ts): its title and each choice's label from the decision and what
// it's for. The decisions are written over a fixture's view, as the engine would show them to the person.

import type { Action, ObjectId, SeatView } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { promptLabel, promptLayout, promptTitle, rankByLabel } from "../src/interaction/prompt-text.ts";
import { fixtureView, mulliganView } from "./fixture-views.ts";

const midGame = fixtureView("mid-game");

/** The id of a card in the mid-game fixture, by name. */
function idOf(name: string): ObjectId {
  const id = Object.keys(midGame.seen).find((key) => {
    const seen = midGame.seen[key as ObjectId];
    return seen?.kind === "card" && seen.characteristics.name === name;
  });
  if (id === undefined) throw new Error(`no ${name} in the fixture`);
  return id as ObjectId;
}

/** The mid-game view with this decision waiting for the person. */
function deciding(decision: unknown): SeatView {
  return { ...midGame, view: { ...midGame.view, decision: decision as SeatView["view"]["decision"] } };
}

function answer(a: unknown): Action {
  return { type: "ANSWER", decisionId: "d1", player: "p1", answer: a } as unknown as Action;
}

describe("the prompt's words", () => {
  it("mulligan: how many cards, and Arena's buttons, Keep 7 and Mulligan (CR 103.5)", () => {
    const shown = mulliganView();
    const hand = shown.view.zones.players.p1?.hand?.length;
    expect(promptTitle(shown)).toBe(`Keep these ${hand} cards?`);
    expect(promptLabel(shown, answer({ kind: "mulligan", choice: "keep" }))).toBe(`Keep ${hand}`);
    expect(promptLabel(shown, answer({ kind: "mulligan", choice: "mulligan" }))).toBe("Mulligan");
    // After one mulligan, a card has already gone to the bottom (CR 103.5): the question is about the six left.
    const p1 = shown.view.zones.players.p1;
    if (p1 === undefined || p1.hand === null) throw new Error("no hand");
    const six = p1.hand.slice(0, 6);
    const again: SeatView = {
      ...shown,
      view: {
        ...shown.view,
        zones: { ...shown.view.zones, players: { ...shown.view.zones.players, p1: { ...p1, hand: six } } },
        decision: { kind: "mulligan", mulligansTaken: 1 } as SeatView["view"]["decision"],
      },
    };
    expect(promptTitle(again)).toBe("Keep these 6 cards?");
    expect(promptLabel(again, answer({ kind: "mulligan", choice: "keep" }))).toBe("Keep 6");
  });

  it("X: names the spell, and its choices are a row of numbers", () => {
    const shown = deciding({ kind: "announceX", object: idOf("Lightning Bolt"), upTo: 3 });
    expect(promptTitle(shown)).toBe("Choose X for Lightning Bolt");
    expect(promptLabel(shown, answer({ kind: "announceX", value: 2 }))).toBe("2");
    expect(promptLayout(shown)).toBe("numbers");
  });

  it("dividing damage: how much of what's left goes to the next target (CR 601.2d)", () => {
    const vanguard = { kind: "object", object: idOf("Elite Vanguard") };
    const shown = deciding({
      kind: "divide",
      object: idOf("Lightning Bolt"),
      instance: 0,
      amount: 5,
      targets: [{ kind: "player", player: "p2" }, vanguard],
      shares: [2],
    });
    expect(promptTitle(shown)).toBe("How much of 3 to Elite Vanguard?");
    expect(promptLabel(shown, answer({ kind: "divide", amount: 1 }))).toBe("1");
  });

  it("combat damage: the source, what's left, who gets it, and lethal marked (CR 510.1c, 702.19b)", () => {
    const shown = deciding({
      kind: "assignDamage",
      source: idOf("Stampeding Rhino"),
      recipients: [
        { kind: "object", object: idOf("Elite Vanguard") },
        { kind: "player", player: "p2" },
      ],
      lethal: [3, 0],
      amount: 4,
      assigned: [],
      divided: [],
    });
    expect(promptTitle(shown)).toBe("Stampeding Rhino deals 4 damage: how much to Elite Vanguard?");
    expect(promptLabel(shown, answer({ kind: "assignDamage", amount: 3 }))).toBe("3 (lethal)");
    expect(promptLabel(shown, answer({ kind: "assignDamage", amount: 4 }))).toBe("4");
  });

  it("trigger order: each trigger by its source, first on the stack resolving last (CR 603.3b)", () => {
    const trigger = (name: string) => ({
      source: idOf(name),
      sourceOracleId: "x",
      ref: {},
      controller: "p1",
      event: {},
    });
    const shown = deciding({
      kind: "orderTriggers",
      batch: [trigger("Llanowar Elves"), trigger("Prodigal Pyromancer")],
      priorityTo: "p1",
    });
    expect(promptTitle(shown)).toBe("Which goes on the stack first? It resolves last");
    expect(promptLabel(shown, answer({ kind: "orderTrigger", index: 1 }))).toBe("Prodigal Pyromancer trigger");
  });

  it("choosing cards: the purpose and how many, and each card by name, even one shown by identity only (D-062)", () => {
    const seen = midGame.seen[idOf("Lightning Bolt")];
    if (seen?.kind !== "card" || seen.oracleId === null) throw new Error("no Lightning Bolt oracle id");
    const shown = deciding({
      kind: "chooseCards",
      purpose: "search",
      for: null,
      options: [{ oracleId: seen.oracleId, object: null }],
      min: 0,
      max: 1,
      chosen: [],
      endsOnlyOnFinish: false,
      seen: null,
    });
    expect(promptTitle(shown)).toBe("Search for up to 1 card");
    expect(promptLabel(shown, answer({ kind: "chooseCard", option: 0 }))).toBe("Lightning Bolt");
  });

  it("the legend rule, shuffling, and naming a card, with a filter box for the long list", () => {
    const legend = deciding({ kind: "keepLegend", options: [idOf("Llanowar Elves")], kept: [], priorityTo: "p1" });
    expect(promptLabel(legend, answer({ kind: "chooseCard", option: 0 }))).toBe("Keep Llanowar Elves");
    const shuffle = deciding({ kind: "chooseYesNo", purpose: "shuffle", canSayYes: true });
    expect(promptTitle(shuffle)).toBe("Shuffle your library?");
    const naming = deciding({ kind: "chooseName", what: "cardName", answering: { kind: "resolution" } });
    expect(promptTitle(naming)).toBe("Name a card");
    expect(promptLayout(naming)).toBe("filtered");
    expect(promptLabel(naming, answer({ kind: "chooseName", name: "Shivan Dragon" }))).toBe("Shivan Dragon");
  });

  it("names every other decision by what it's for", () => {
    const bolt = idOf("Lightning Bolt");
    const titles = {
      chooseStartingPlayer: deciding({ kind: "chooseStartingPlayer" }),
      mulliganBottom: deciding({ kind: "mulliganBottom", remaining: 2 }),
      discardToHandSize: deciding({ kind: "discardToHandSize", remaining: 1, chosen: [] }),
      chooseTarget: deciding({ kind: "chooseTarget", object: bolt, instance: 0 }),
      chooseTargetCount: deciding({ kind: "chooseTargetCount", object: bolt, instance: 0, min: 1, max: 3 }),
      payMana: deciding({ kind: "payMana", object: bolt, cost: {} }),
      chooseSacrifice: deciding({ kind: "chooseSacrifice", object: idOf("Prodigal Pyromancer") }),
      keepLegend: deciding({ kind: "keepLegend", options: [], kept: [], priorityTo: "p1" }),
      chooseNewTarget: deciding({ kind: "chooseNewTarget", object: bolt, instance: 0, index: 0, original: {} }),
    };
    expect(Object.fromEntries(Object.entries(titles).map(([k, v]) => [k, promptTitle(v)]))).toEqual({
      chooseStartingPlayer: "Who goes first?",
      mulliganBottom: "Put 2 cards on the bottom of your library",
      discardToHandSize: "Discard 1 card down to your hand size",
      chooseTarget: "Choose a target for Lightning Bolt",
      chooseTargetCount: "How many targets for Lightning Bolt?",
      payMana: "Pay for Lightning Bolt",
      chooseSacrifice: "Choose what to sacrifice for Prodigal Pyromancer",
      keepLegend: "Choose the legend to keep",
      chooseNewTarget: "Choose a new target for Lightning Bolt",
    });
    // A triggered "you may", while its source resolves: named by what's on top of the stack.
    const may = deciding({ kind: "chooseYesNo", purpose: "optional", canSayYes: true });
    const withTop: SeatView = {
      ...may,
      view: { ...may.view, zones: { ...may.view.zones, stack: [idOf("Llanowar Elves")] } },
    };
    expect(promptTitle(withTop)).toBe("Llanowar Elves: do you want to?");
  });

  it("choosing cards: each purpose in words, and what an Aura enchants or a Clone copies", () => {
    const seen = midGame.seen[idOf("Elite Vanguard")];
    const forClone = seen?.kind === "card" ? { oracleId: seen.oracleId, object: null } : null;
    const choose = (purpose: string, min: number, max: number) =>
      promptTitle(
        deciding({
          kind: "chooseCards",
          purpose,
          for: forClone,
          options: [],
          min,
          max,
          chosen: [],
          endsOnlyOnFinish: false,
        }),
      );
    expect(choose("putOnTop", 1, 1)).toBe("Choose 1 card to put on top");
    expect(choose("putOnBottom", 2, 2)).toBe("Choose 2 cards to put on the bottom");
    expect(choose("discard", 0, 2)).toBe("Discard up to 2 cards");
    expect(choose("enchant", 1, 1)).toBe("Choose what Elite Vanguard enchants");
    expect(choose("copy", 0, 1)).toBe("Choose what Elite Vanguard copies");
  });

  it("replacement order: each effect by where it comes from (CR 616.1)", () => {
    const pyromancer = idOf("Prodigal Pyromancer");
    const shown = deciding({
      kind: "chooseReplacement",
      for: { kind: "object", object: pyromancer },
      options: [
        { kind: "ownText", object: idOf("Honor of the Pure"), index: 0 },
        { kind: "regenerationShield", object: pyromancer },
        { kind: "protection", object: pyromancer },
        { kind: "resolvedEffect", id: "o999" },
      ],
    });
    const label = (option: number) => promptLabel(shown, answer({ kind: "chooseReplacement", option }));
    expect([label(0), label(1), label(2), label(3)]).toEqual([
      "Honor of the Pure first",
      "Prodigal Pyromancer's regeneration first",
      "Prodigal Pyromancer's protection first",
      "A prevention effect first",
    ]);
  });

  it("a trigger whose source has left (a new object in the graveyard, CR 400.7) is named by its card", () => {
    const elves = midGame.seen[idOf("Llanowar Elves")];
    if (elves?.kind !== "card" || elves.oracleId === null) throw new Error("no oracle id");
    const gone = { source: "o999", sourceOracleId: elves.oracleId, ref: {}, controller: "p1", event: {} };
    const shown = deciding({ kind: "orderTriggers", batch: [gone], priorityTo: "p1" });
    expect(promptLabel(shown, answer({ kind: "orderTrigger", index: 0 }))).toBe("Llanowar Elves trigger");
  });

  it("naming a basic land type is five buttons; naming a card is a filter box", () => {
    const land = deciding({ kind: "chooseName", what: "basicLandType", answering: { kind: "resolution" } });
    expect(promptTitle(land)).toBe("Choose a basic land type");
    expect(promptLayout(land)).toBe("buttons");
  });

  it("the filter ranks the exact name first, then names starting with it, then the rest that contain it", () => {
    const names = ["Mind Shatter", "Shatter", "Shattering Spree", "Unshatterable"].map((label) => ({ label }));
    expect(rankByLabel(names, "shatter").map((c) => c.label)).toEqual([
      "Shatter",
      "Shattering Spree",
      "Mind Shatter",
      "Unshatterable",
    ]);
    expect(rankByLabel(names, "spree").map((c) => c.label)).toEqual(["Shattering Spree"]);
  });
});
