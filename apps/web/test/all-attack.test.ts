// Shaping a declaration of attackers a step at a time (interaction/all-attack.ts): All Attack, Clear Attacks, and
// taking one creature out, each toward a goal through the engine's own picks and take-backs (D-158).

import type { SeatView } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { fixtureSetup } from "../src/fixtures/fixtures.ts";
import {
  allAttackGoal,
  allAttackOffered,
  stepToward,
  type WantedAttack,
  withoutAttacker,
} from "../src/interaction/all-attack.ts";
import { handle } from "../src/worker/match-session.ts";
import { cards } from "./fixture-views.ts";

/** The attack fixture, played on to the declaration of attackers, through the worker's own session. */
function atDeclaration() {
  const setup = fixtureSetup("attack");
  if (setup === null) throw new Error("no attack fixture");
  let step = handle(null, { type: "startFrom", setup, human: "p1" }, cards);
  const shown = (): SeatView => {
    if (step.reply.type !== "update") throw new Error(step.reply.message);
    return step.reply.shown;
  };
  for (let i = 0; i < 6 && shown().view.decision?.kind !== "declareAttackers"; i++) {
    const pass = shown().options.find((o) => o.action.type === "PASS_PRIORITY");
    if (pass === undefined) throw new Error("no pass");
    step = handle(step.session, { type: "act", action: pass.action }, cards);
  }
  /** Moves toward the goal as the app does, one step per reply; returns how many steps it took. */
  const reach = (goal: WantedAttack[]) => {
    for (let i = 0; i < 20; i++) {
      const next = stepToward(shown(), goal);
      if (next === null) return i;
      step = handle(step.session, { type: "act", action: next }, cards);
    }
    throw new Error("never got there");
  };
  const attackers = () => {
    const d = shown().view.decision;
    return d?.kind === "declareAttackers" ? d.chosen.map((a) => a.attacker) : [];
  };
  const name = (id: string) => {
    const seen = shown().seen[id as keyof SeatView["seen"]];
    return seen?.kind === "card" ? seen.characteristics.name : id;
  };
  return { shown, reach, attackers, name };
}

describe("shaping the attack", () => {
  it("All Attack: every creature that can attack a player, one engine pick at a time (CR 508.1a), then it can finish", () => {
    const game = atDeclaration();
    expect(allAttackOffered(game.shown())).toBe(true);
    expect(game.reach(allAttackGoal(game.shown()))).toBe(4);
    expect(game.attackers()).toHaveLength(4);
    // Every requirement obeyed (Berserkers of Blood Ridge attacks each combat): the declaration can be finished.
    expect(
      game.shown().options.some((o) => o.action.type === "ANSWER" && o.action.answer.kind === "finishDeclaring"),
    ).toBe(true);
    expect(allAttackOffered(game.shown())).toBe(false);
  });

  it("taking one creature out: the take-back undoes the last pick only, so later picks are taken back and made again", () => {
    const game = atDeclaration();
    game.reach(allAttackGoal(game.shown()));
    const [first, ...rest] = game.attackers();
    if (first === undefined) throw new Error("no attackers");
    // Out goes the first one picked: three take-backs (the last three), one more for it, then three picks again.
    expect(game.reach(withoutAttacker(game.shown(), first))).toBe(7);
    expect(game.attackers()).toEqual(rest);
  });

  it("Clear Attacks: back to none, every pick taken back", () => {
    const game = atDeclaration();
    game.reach(allAttackGoal(game.shown()));
    expect(game.reach([])).toBe(4);
    expect(game.attackers()).toEqual([]);
  });

  it("a wanted attacker the engine doesn't offer is skipped, not waited for", () => {
    const game = atDeclaration();
    const before = game.attackers();
    expect(game.reach([{ attacker: "o999" as WantedAttack["attacker"] }])).toBe(0);
    expect(game.attackers()).toEqual(before);
  });
});
