// seatView (M3-02, D-144): what one player is shown when they decide. That it shows nothing hidden is checked over many
// scenario states by the CLI's `brief.test.ts` and after every fuzzed action (`viewsLeakNothing`); these tests check
// what each option says.

import { describe, expect, it } from "vitest";
import { type ObjectId, seatView } from "../../src/index.ts";
import { BEARS, FOREST, LONER, MOUNTAIN, PINGER, SHOCK, TEST_CARDS } from "../support/cards.ts";
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
    expect(cast).toMatchObject({ payable: true, mightPay: true, ability: null, finishes: null });
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

  it("says whether a declaration could be finished after each pick (CR 508.1c)", () => {
    let g = game({ battlefield: [permanent(LONER), permanent(BEARS)] });
    const [loner, bears] = g.state.zones.battlefield as [ObjectId, ObjectId];
    g = passBoth(passBoth(g));
    const picks = seatView(g.state, "p1", TEST_CARDS).options.filter(
      (o) => o.action.type === "ANSWER" && o.action.answer.kind === "declareAttacker",
    );
    const attacker = (o: (typeof picks)[number]) =>
      o.action.type === "ANSWER" && o.action.answer.kind === "declareAttacker" ? o.action.answer.attack.attacker : null;
    // The Loner can't attack alone; the Bears can.
    expect(picks.find((o) => attacker(o) === loner)?.finishes).toBe(false);
    expect(picks.find((o) => attacker(o) === bears)?.finishes).toBe(true);
  });

  it("lists no options while another player decides", () => {
    const { state } = game({ hand: [SHOCK] });
    expect(seatView(state, "p2", TEST_CARDS).options).toStrictEqual([]);
  });
});
