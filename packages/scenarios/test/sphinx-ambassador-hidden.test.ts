// Sphinx Ambassador: the player naming a card mustn't learn which card was searched for (its ruling: it's never shown to
// them; CR 701.23e), nor whether it could have been put onto the battlefield (D-121). Two worlds that differ only in the
// card found, and where it was in the library: everything p2 is shown at every step must be the same in both. And a
// name chosen as a permanent enters, whose view leaves out the engine's bookkeeping.

import { cardDatabase } from "@mtg/cards";
import { playerView } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { runScenario } from "../src/index.ts";

const cards = cardDatabase();

/** p2's views at every step, when p1 finds `found` in p2's library and declines to put it onto the battlefield. */
function viewsWhenFound(library: string[], found: string): string[] {
  const yaml = `name: Sphinx Ambassador finds ${found}
rules: [CR 701.23e]
setup:
  turn: { active: p1, step: main1 }
  p1:
    battlefield: [Sphinx Ambassador]
  p2:
    library: [${library.join(", ")}]
steps:
  - all pass: until combat.declareAttackers
  - p1 attack: [Sphinx Ambassador]
  - all pass: until combat.damage
  - all pass: once
  - p1 choose: ${found}
  - p2 choose: Grizzly Bears
  - p1 choose: no
`;
  const views: string[] = [];
  const result = runScenario(yaml, cards, (state) => {
    const view = JSON.stringify(playerView(state, "p2"));
    if (views.at(-1) !== view) views.push(view);
    return [];
  });
  expect(result.problems).toStrictEqual([]);
  return views;
}

describe("a name chosen as a permanent enters, seen by the player choosing", () => {
  it("shows what it's for, not the event the engine resumes", () => {
    const yaml = `name: Pithing Needle asks for a name
rules: [CR 614.12a]
setup:
  turn: { active: p1, step: main1 }
  p1:
    battlefield: [Island]
    hand: [Pithing Needle]
steps:
  - p1 cast: Pithing Needle
    pay: auto
  - all pass: once
  - p1 choose: Grizzly Bears
`;
    const decisions: unknown[] = [];
    const result = runScenario(yaml, cards, (state) => {
      if (state.pending?.kind === "chooseName") decisions.push(playerView(state, "p1").decision);
      return [];
    });
    expect(result.problems).toStrictEqual([]);
    const [decision] = decisions;
    expect(decision).toMatchObject({ kind: "chooseName", answering: { kind: "asEnters" } });
    expect(decision).not.toHaveProperty("answering.resume");
  });
});

describe("Sphinx Ambassador's search, seen by the player naming", () => {
  it("shows them the same game whether a creature not named, declined, or a noncreature card was found", () => {
    const creature = viewsWhenFound(["Craw Wurm", "Island"], "Craw Wurm");
    const noncreature = viewsWhenFound(["Island", "Lightning Bolt"], "Lightning Bolt");
    expect(creature.some((v) => v.includes('"kind":"chooseYesNo"'))).toBe(true);
    expect(noncreature).toStrictEqual(creature);
  });
});
