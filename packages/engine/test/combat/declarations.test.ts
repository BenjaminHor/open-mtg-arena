// Finishing a declaration only when it's legal, and taking back a pick (CR 508.1c, 506.5): a declaration that can't be
// finished never leaves the player stuck.

import { describe, expect, it } from "vitest";
import { applyAction, legalActions, type ObjectId } from "../../src/index.ts";
import { FOREST, LONER, TEST_CARDS } from "../support/cards.ts";
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
    expect(kinds(game)).toStrictEqual(["declareAttacker", "finishDeclaring"]);
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
