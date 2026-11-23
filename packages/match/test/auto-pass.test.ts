// Smart auto-pass (D-143, D-157): the host passes for a player with nothing they could do, stops them at every window
// where they could act (as Arena does) but for their own upkeep, draw step and end step, and lets their own spell
// resolve without asking them.

import type { Action, ObjectId } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { advance, DEFAULT_SETTINGS, startMatch, waitingOn } from "../src/index.ts";
import { act, answers, cards, handMade, passes } from "./helpers.ts";

const human = { kind: "human" } as const;
const people = { p1: human, p2: human };

describe("auto-pass", () => {
  it("stops at any window where the player could act: the opponent's upkeep, holding a Lightning Bolt they can pay for", () => {
    const setup = handMade({}, { hand: ["Lightning Bolt"], battlefield: ["Mountain"] }, "upkeep");
    const match = advance(startMatch(setup, people, cards), cards);
    // p1, the active player, has nothing to do and is passed for; p2 is stopped in p1's upkeep.
    expect(waitingOn(match, cards)).toBe("p2");
    expect(match.state.turn?.step).toBe("upkeep");
  });

  it("skips the player's own upkeep, draw step and end step, as Arena does, even holding a spell (D-157)", () => {
    const setup = handMade({ hand: ["Lightning Bolt"], battlefield: ["Mountain"], library: "Plains" }, {}, "upkeep");
    let match = advance(startMatch(setup, people, cards), cards);
    // Straight on to their first main phase.
    expect([waitingOn(match, cards), match.state.turn?.step]).toStrictEqual(["p1", "precombatMain"]);
    // Then on through combat and the second main phase, past their own end step, until the turn passes to p2.
    const steps: string[] = [];
    for (let i = 0; i < 12 && match.state.turn?.number === 3; i++) {
      steps.push(match.state.turn?.step ?? "");
      match = act(match, passes);
    }
    expect(steps).not.toContain("end");
    expect(match.state.turn?.number).toBeGreaterThan(3);
  });

  it("stops in the player's own end step while mana is left in their pool, which empties as the step ends (CR 500.5)", () => {
    const setup = handMade({ hand: ["Lightning Bolt"], battlefield: ["Mountain"] }, {}, "end");
    const withMana: typeof setup = {
      ...setup,
      players: setup.players.map((p) => (p.id === "p1" ? { ...p, manaPool: { ...p.manaPool, R: 1 } } : p)),
    };
    const match = advance(startMatch(withMana, people, cards), cards);
    expect([waitingOn(match, cards), match.state.turn?.step]).toStrictEqual(["p1", "end"]);
    // Without the mana, the same end step goes by.
    const without = advance(startMatch(setup, people, cards), cards);
    expect([waitingOn(without, cards), without.state.turn?.step]).not.toStrictEqual(["p1", "end"]);
  });

  it("stops the player in their own upkeep while mana is left in their pool (CR 500.5)", () => {
    const setup = handMade({ hand: ["Lightning Bolt"], battlefield: ["Mountain"] }, {}, "upkeep");
    const withMana: typeof setup = {
      ...setup,
      players: setup.players.map((p) => (p.id === "p1" ? { ...p, manaPool: { ...p.manaPool, R: 1 } } : p)),
    };
    const match = advance(startMatch(withMana, people, cards), cards);
    expect([waitingOn(match, cards), match.state.turn?.step]).toStrictEqual(["p1", "upkeep"]);
  });

  it("in the player's own upkeep, passes for their own trigger, and stops them for the opponent's spell (D-157)", () => {
    // Xathrid Demon's upkeep trigger is p1's own: p1 is passed for, and p2, holding a Bolt, is stopped to respond.
    const setup = handMade(
      { hand: ["Lightning Bolt"], battlefield: ["Xathrid Demon", "Grizzly Bears", "Mountain"] },
      { hand: ["Lightning Bolt"], battlefield: ["Mountain"] },
      "end",
    );
    // From the end of p2's turn, so p1's upkeep begins in play and its trigger fires.
    const fromP2: typeof setup = {
      ...setup,
      opening: { kind: "fixed", turn: { number: 2, activePlayer: "p2", step: "end" } },
    };
    let match = advance(startMatch(fromP2, people, cards), cards);
    // p1, holding a Bolt, is stopped in p2's end step: passing on to their own turn.
    while (match.state.turn?.activePlayer === "p2") match = act(match, passes);
    expect([waitingOn(match, cards), match.state.turn?.step, match.state.zones.stack.length]).toStrictEqual([
      "p2",
      "upkeep",
      1,
    ]);
    // p2 bolts p1 in response: an opponent's object on the stack stops p1 even in p1's own upkeep.
    match = act(match, (a) => a.type === "CAST_SPELL");
    while (waitingOn(match, cards) === "p2") {
      match = act(
        match,
        (a) =>
          a.type === "ANSWER" &&
          a.answer.kind === "chooseTarget" &&
          a.answer.target.kind === "player" &&
          a.answer.target.player === "p1",
      );
    }
    expect([waitingOn(match, cards), match.state.turn?.step, match.state.zones.stack.length]).toStrictEqual([
      "p1",
      "upkeep",
      2,
    ]);
  });

  it("never stops a player who can't pay for anything", () => {
    // Libraries of Lightning Bolts: no land is ever drawn, so nothing can be paid for.
    const setup = handMade(
      { hand: ["Lightning Bolt"], library: "Lightning Bolt" },
      { library: "Lightning Bolt" },
      "upkeep",
    );
    const match = advance(startMatch(setup, people, cards), cards);
    // Nobody had anything to do, so the game went on until a library ran out (CR 704.5b).
    expect(match.state.result).not.toBeNull();
    expect(match.actions.every((a) => a.type === "PASS_PRIORITY" || a.type === "ANSWER")).toBe(true);
  });

  it("with auto-pass off (full control), stops at every priority, even with nothing to do", () => {
    const setup = handMade({ library: "Lightning Bolt" }, { library: "Lightning Bolt" }, "upkeep");
    const off = { ...DEFAULT_SETTINGS, autoPass: false };
    const match = advance(startMatch(setup, people, cards, { p1: off }), cards);
    expect(waitingOn(match, cards)).toBe("p1");
    expect(match.state.turn?.step).toBe("upkeep");
  });

  it("gives both players their window for a trick after blockers, and an opponent's spell stops them; their own doesn't", () => {
    const side = { hand: ["Giant Growth"], battlefield: ["Grizzly Bears", "Forest"], library: "Forest" };
    let match = advance(startMatch(handMade(side, side, "precombatMain"), people, cards), cards);
    // Into combat: p1 passes their windows until they declare the Bears as an attacker.
    while (match.state.pending?.kind !== "declareAttackers") match = act(match, passes);
    const [p1Bears, , p2Bears] = match.state.zones.battlefield as [ObjectId, ObjectId, ObjectId];
    match = act(
      match,
      (a) => a.type === "ANSWER" && a.answer.kind === "declareAttacker" && a.answer.attack.attacker === p1Bears,
    );
    match = act(match, answers("finishDeclaring"));
    while (match.state.pending?.kind !== "declareBlockers") match = act(match, passes);
    match = act(
      match,
      (a) => a.type === "ANSWER" && a.answer.kind === "declareBlocker" && a.answer.block.blocker === p2Bears,
    );
    match = act(match, answers("finishDeclaring"));
    // The declare blockers step: the attacker is asked first, holding a Giant Growth they can pay for.
    expect([waitingOn(match, cards), match.state.turn?.step]).toStrictEqual(["p1", "declareBlockers"]);
    // p1 casts it; auto-tap pays; with their own spell on top, the host passes for them; p2 is stopped to respond.
    match = act(match, (a) => a.type === "CAST_SPELL");
    while (match.state.pending?.kind === "chooseTarget") match = act(match, (a: Action) => a.type === "ANSWER");
    expect(match.state.zones.stack).toHaveLength(1);
    expect([waitingOn(match, cards), match.state.turn?.step]).toStrictEqual(["p2", "declareBlockers"]);
  });
});
