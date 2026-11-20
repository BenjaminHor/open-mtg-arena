// Finishing a declaration only when it's legal, and taking back a pick (CR 508.1c, 506.5): a declaration that can't be
// finished never leaves the player stuck.

import { describe, expect, it } from "vitest";
import { applyAction, legalActions, type ObjectId } from "../../src/index.ts";
import { BEARS, FOREST, LONER, TEST_CARDS } from "../support/cards.ts";
import { answer, passBoth, playerSetup, start } from "../support/game.ts";

const permanent = (oracleId: string) => ({ oracleId, tapped: false, summoningSick: false, damage: 0, counters: {} });

const kinds = (game: ReturnType<typeof start>) =>
  legalActions(game.state, "p1", TEST_CARDS).map((a) => (a.type === "ANSWER" ? a.answer.kind : a.type));

describe("declaring attackers with a creature that can't attack alone", () => {
  it("isn't offered finishing with it alone; taking it back makes finishing legal again", () => {
    let game = start({
      seed: 1,
      players: [
        playerSetup("p1", { library: [FOREST, FOREST], battlefield: [permanent(LONER)] }),
        playerSetup("p2", { library: [FOREST, FOREST] }),
      ],
      opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
      ruleModifiers: [],
    });
    const [loner] = game.state.zones.battlefield as [ObjectId];
    game = passBoth(passBoth(game));
    expect(kinds(game)).toStrictEqual(["finishDeclaring", "declareAttacker"]);
    game = answer(game, { kind: "declareAttacker", attack: { attacker: loner, defender: "p2" } });
    // Alone, the declaration can't be finished, and nothing else can join it: only taking it back is left.
    expect(kinds(game)).toStrictEqual(["takeBack"]);
    const pending = game.state.pending;
    if (pending === null) throw new Error("nothing pending");
    const finish = {
      type: "ANSWER",
      decisionId: pending.id,
      player: "p1",
      answer: { kind: "finishDeclaring" },
    } as const;
    expect(applyAction(game.state, finish, TEST_CARDS)).toMatchObject({ ok: false, error: { code: "illegalAction" } });
    game = answer(game, { kind: "takeBack" });
    expect(game.state.pending).toMatchObject({ kind: "declareAttackers", chosen: [] });
    game = answer(game, { kind: "finishDeclaring" });
    expect(game.state.pending?.kind).toBe("priority");
  });
});

describe("taking back a pick (CR 509.1)", () => {
  it("removes the last block, and isn't offered or accepted with nothing declared", () => {
    let game = start({
      seed: 1,
      players: [
        playerSetup("p1", { library: [FOREST, FOREST], battlefield: [permanent(BEARS), permanent(BEARS)] }),
        playerSetup("p2", { library: [FOREST, FOREST], battlefield: [permanent(BEARS), permanent(BEARS)] }),
      ],
      opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
      ruleModifiers: [],
    });
    const [a1, a2, b1, b2] = game.state.zones.battlefield as [ObjectId, ObjectId, ObjectId, ObjectId];
    game = passBoth(passBoth(game));
    const pending = game.state.pending;
    if (pending === null) throw new Error("nothing pending");
    const takeBack = (decisionId: typeof pending.id, player: "p1" | "p2") =>
      ({ type: "ANSWER", decisionId, player, answer: { kind: "takeBack" } }) as const;
    expect(kinds(game)).not.toContain("takeBack");
    expect(applyAction(game.state, takeBack(pending.id, "p1"), TEST_CARDS)).toMatchObject({ ok: false });
    game = answer(game, { kind: "declareAttacker", attack: { attacker: a1, defender: "p2" } });
    game = answer(game, { kind: "declareAttacker", attack: { attacker: a2, defender: "p2" } });
    game = passBoth(answer(game, { kind: "finishDeclaring" }));
    game = answer(game, { kind: "declareBlocker", block: { blocker: b1, attacker: a1 } });
    game = answer(game, { kind: "declareBlocker", block: { blocker: b2, attacker: a2 } });
    game = answer(game, { kind: "takeBack" });
    expect(game.state.pending).toMatchObject({ kind: "declareBlockers", chosen: [{ blocker: b1, attacker: a1 }] });
    game = answer(game, { kind: "takeBack" });
    const empty = game.state.pending;
    if (empty === null) throw new Error("nothing pending");
    expect(applyAction(game.state, takeBack(empty.id, "p2"), TEST_CARDS)).toMatchObject({
      ok: false,
      error: { code: "illegalAction" },
    });
  });
});
