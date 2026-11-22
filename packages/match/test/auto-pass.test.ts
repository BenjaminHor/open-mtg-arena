// Smart auto-pass (D-143): the host passes for a player with nothing they could do, stops them at every window where
// they could act (as Arena does), and lets their own spell resolve without asking them.

import type { Action, ObjectId } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { advance, DEFAULT_SETTINGS, startMatch, waitingOn } from "../src/index.ts";
import { act, answers, cards, handMade, passes } from "./helpers.ts";

const human = { kind: "human" } as const;
const people = { p1: human, p2: human };

describe("auto-pass", () => {
  it("stops at any window where the player could act: the upkeep, holding a Lightning Bolt they can pay for", () => {
    const setup = handMade({ hand: ["Lightning Bolt"], battlefield: ["Mountain"] }, {}, "upkeep");
    const match = advance(startMatch(setup, people, cards), cards);
    expect(waitingOn(match, cards)).toBe("p1");
    expect(match.state.turn?.step).toBe("upkeep");
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
