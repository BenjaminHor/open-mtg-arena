// seatView (M3-02, D-144): what one player is shown when they decide. That it shows nothing hidden is checked over many
// scenario states by the CLI's `brief.test.ts` and after every fuzzed action (`viewsLeakNothing`); these tests check
// what each option says.

import { describe, expect, it } from "vitest";
import { applyAction, type ObjectId, seatView } from "../../src/index.ts";
import { BEARS, FOREST, LONER, MOUNTAIN, PINGER, SHOCK, TEST_CARDS, X_BOLT } from "../support/cards.ts";
import { passBoth, playerSetup, start } from "../support/game.ts";

const permanent = (oracleId: string, tapped = false) => ({
  oracleId,
  tapped,
  summoningSick: false,
  damage: 0,
  counters: {},
});

function game(p1: { hand?: string[]; battlefield?: ReturnType<typeof permanent>[] }) {
  return start({
    seed: 1,
    players: [
      playerSetup("p1", { library: [FOREST], ...p1 }),
      playerSetup("p2", { library: [FOREST], battlefield: [permanent(BEARS)] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  });
}

describe("seatView", () => {
  it("gives a spell its mana cost, whether the engine can pay it now, and its legal targets (CR 601.2c, 115)", () => {
    const { state } = game({ hand: [SHOCK], battlefield: [permanent(MOUNTAIN)] });
    const shown = seatView(state, "p1", TEST_CARDS);
    const cast = shown.options.find((o) => o.action.type === "CAST_SPELL");
    expect(cast).toMatchObject({ payable: true, mightPay: true, ability: null, finishable: null });
    expect(cast?.manaCost).toStrictEqual([{ kind: "colored", color: "R" }]);
    const bears = state.zones.battlefield[1];
    expect(cast?.targets[0]).toContainEqual({ kind: "object", object: bears });
    expect(cast?.targets[0]).toContainEqual({ kind: "player", player: "p2" });
  });

  it("says a spell can't be paid for now when its mana is tapped", () => {
    const { state } = game({ hand: [SHOCK], battlefield: [permanent(MOUNTAIN, true)] });
    const cast = seatView(state, "p1", TEST_CARDS).options.find((o) => o.action.type === "CAST_SPELL");
    expect(cast).toMatchObject({ payable: false, mightPay: false });
  });

  it("gives an activation the ability as its source has it now", () => {
    const { state } = game({ battlefield: [permanent(PINGER), permanent(MOUNTAIN)] });
    const [pinger] = state.zones.battlefield as [ObjectId];
    const activate = seatView(state, "p1", TEST_CARDS).options.find(
      (o) => o.action.type === "ACTIVATE_ABILITY" && o.action.object === pinger,
    );
    expect(activate?.ability).toStrictEqual(TEST_CARDS[PINGER]?.def.abilities?.[0]);
  });

  it("says whether a declaration could still be finished after each pick, with more picks if need be (CR 508.1c)", () => {
    const lonerPick = (battlefield: ReturnType<typeof permanent>[]) => {
      let g = game({ battlefield });
      const [loner] = g.state.zones.battlefield as [ObjectId];
      g = passBoth(passBoth(g));
      return seatView(g.state, "p1", TEST_CARDS).options.find(
        (o) =>
          o.action.type === "ANSWER" &&
          o.action.answer.kind === "declareAttacker" &&
          o.action.answer.attack.attacker === loner,
      );
    };
    // The Loner can't attack alone: with nothing to join it, that pick can't be finished; with the Bears, it can.
    expect(lonerPick([permanent(LONER)])?.finishable).toBe(false);
    expect(lonerPick([permanent(LONER), permanent(BEARS)])?.finishable).toBe(true);
  });

  it("gives each X a spell could be announced with its whole cost, and whether it can be paid (CR 601.2b)", () => {
    const g = game({ hand: [X_BOLT], battlefield: [permanent(MOUNTAIN), permanent(MOUNTAIN)] });
    const pending = g.state.pending;
    if (pending === null) throw new Error("nothing pending");
    const bolt = g.state.zones.players.p1?.hand[0] as ObjectId;
    const cast = applyAction(
      g.state,
      { type: "CAST_SPELL", decisionId: pending.id, player: "p1", object: bolt },
      TEST_CARDS,
    );
    if (!cast.ok) throw new Error(cast.error.message);
    const xs = seatView(cast.state, "p1", TEST_CARDS).options.flatMap((o) =>
      o.action.type === "ANSWER" && o.action.answer.kind === "announceX"
        ? [{ x: o.action.answer.value, cost: o.manaCost, payable: o.payable }]
        : [],
    );
    expect(xs).toStrictEqual([
      { x: 0, cost: [{ kind: "colored", color: "R" }], payable: true },
      {
        x: 1,
        cost: [
          { kind: "generic", amount: 1 },
          { kind: "colored", color: "R" },
        ],
        payable: true,
      },
    ]);
  });

  it("lists no options while another player decides", () => {
    const { state } = game({ hand: [SHOCK] });
    expect(seatView(state, "p2", TEST_CARDS).options).toStrictEqual([]);
  });
});
