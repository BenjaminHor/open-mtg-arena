// All Attack (interaction/all-attack.ts): which picks it makes, one at a time, and when it's offered.

import type { Action, ObjectId, SeatView } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { fixtureSetup } from "../src/fixtures/fixtures.ts";
import { allAttackOffered, nextAllAttackPick } from "../src/interaction/all-attack.ts";
import { handle } from "../src/worker/match-session.ts";
import { cards, fixtureView } from "./fixture-views.ts";

const midGame = fixtureView("mid-game");

const pick = (attacker: string, attacked?: string): SeatView["options"][number] => ({
  ...(midGame.options[0] as SeatView["options"][number]),
  action: {
    type: "ANSWER",
    decisionId: "d1",
    player: "p1",
    answer: { kind: "declareAttacker", attack: { attacker, defender: "p2", ...(attacked ? { attacked } : {}) } },
  } as unknown as Action,
});

function declaring(options: SeatView["options"], chosen: { attacker: string }[] = []): SeatView {
  return {
    ...midGame,
    options,
    view: {
      ...midGame.view,
      decision: { kind: "declareAttackers", chosen } as unknown as SeatView["view"]["decision"],
    },
  };
}

const attackerOf = (action: Action | null) =>
  action?.type === "ANSWER" && action.answer.kind === "declareAttacker" ? action.answer.attack.attacker : null;

describe("All Attack", () => {
  it("picks each creature that can attack the opponent, one at a time, skipping those already attacking (CR 508.1a)", () => {
    const shown = declaring([pick("o1"), pick("o2"), pick("o3")], [{ attacker: "o1" }]);
    expect(attackerOf(nextAllAttackPick(shown))).toBe("o2");
    expect(attackerOf(nextAllAttackPick(declaring([pick("o3")], [{ attacker: "o1" }, { attacker: "o2" }])))).toBe("o3");
    expect(nextAllAttackPick(declaring([], [{ attacker: "o1" }]))).toBeNull();
  });

  it("attacks the player, never a planeswalker: that's chosen on the card (CR 508.1b)", () => {
    const shown = declaring([pick("o1", "o9"), pick("o1"), pick("o2", "o9")]);
    expect(attackerOf(nextAllAttackPick(shown))).toBe("o1");
    const picks: (ObjectId | null)[] = [];
    let view = shown;
    for (let i = 0; i < 3; i++) {
      const next = nextAllAttackPick(view);
      picks.push(attackerOf(next));
      if (next === null) break;
      view = declaring(
        view.options.filter((o) => attackerOf(o.action) !== attackerOf(next)),
        [
          ...(view.view.decision?.kind === "declareAttackers" ? view.view.decision.chosen : []),
          { attacker: attackerOf(next) as string },
        ],
      );
    }
    expect(picks).toEqual(["o1", null]);
  });

  it("is offered only while two or more creatures could still attack, and never outside a declaration", () => {
    expect(allAttackOffered(declaring([pick("o1"), pick("o2")]))).toBe(true);
    expect(allAttackOffered(declaring([pick("o1"), pick("o1", "o9")]))).toBe(false);
    expect(allAttackOffered(midGame)).toBe(false);
  });

  it("through the real engine: from the attack fixture, picks every creature until none is left, and can finish", () => {
    const setup = fixtureSetup("attack");
    if (setup === null) throw new Error("no attack fixture");
    let step = handle(null, { type: "startFrom", setup, human: "p1" }, cards);
    const shownNow = () => {
      if (step.reply.type !== "update") throw new Error(step.reply.message);
      return step.reply.shown;
    };
    // On to the declaration.
    for (let i = 0; i < 6 && shownNow().view.decision?.kind !== "declareAttackers"; i++) {
      const pass = shownNow().options.find((o) => o.action.type === "PASS_PRIORITY");
      if (pass === undefined) throw new Error("no pass");
      step = handle(step.session, { type: "act", action: pass.action }, cards);
    }
    expect(allAttackOffered(shownNow())).toBe(true);
    for (let i = 0; i < 10; i++) {
      const pick = nextAllAttackPick(shownNow());
      if (pick === null) break;
      step = handle(step.session, { type: "act", action: pick }, cards);
    }
    const decision = shownNow().view.decision;
    expect(decision?.kind === "declareAttackers" ? decision.chosen.length : 0).toBe(4);
    // Every requirement obeyed (Berserkers of Blood Ridge attacks each combat): the declaration can be finished.
    expect(
      shownNow().options.some((o) => o.action.type === "ANSWER" && o.action.answer.kind === "finishDeclaring"),
    ).toBe(true);
    expect(allAttackOffered(shownNow())).toBe(false);
  });
});
