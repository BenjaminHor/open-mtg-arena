// Activated abilities that use the stack (CR 602), for what the M1 pool can't show: an ability with a target (a
// made-up Pinger), its target becoming illegal (CR 608.2b), its source leaving before it resolves (CR 113.7a), and how
// activating and cancelling affect priority (CR 117.3c, 117.4).

import { describe, expect, it } from "vitest";
import { type Action, legalActions, type ObjectId } from "../../src/index.ts";
import { moveCard } from "../../src/zones/move-card.ts";
import { BEARS, PINGER, TEST_CARDS } from "../support/cards.ts";
import { answer, type Game, passBoth, playerSetup, start, take } from "../support/game.ts";

const permanent = (oracleId: string) => ({ oracleId, tapped: false, summoningSick: false, damage: 0, counters: {} });

function setup(): { game: Game; pinger: ObjectId; bears: ObjectId } {
  const game = start({
    seed: 1,
    players: [
      playerSetup("p1", {
        library: ["forest"],
        battlefield: [permanent(PINGER), permanent("mountain"), permanent("mountain")],
      }),
      playerSetup("p2", { library: ["forest"], battlefield: [permanent(BEARS)] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  });
  const [pinger, , , bears] = game.state.zones.battlefield as [ObjectId, ObjectId, ObjectId, ObjectId];
  return { game, pinger, bears };
}

const isPing = (pinger: ObjectId) => (a: Action) => a.type === "ACTIVATE_ABILITY" && a.object === pinger;

/** p1 activates the Pinger at this target and pays with a Mountain. */
function ping(game: Game, pinger: ObjectId, target: ObjectId | "p2"): Game {
  let g = take(game, isPing(pinger));
  const chosen =
    target === "p2" ? ({ kind: "player", player: "p2" } as const) : ({ kind: "object", object: target } as const);
  g = answer(g, { kind: "chooseTarget", target: chosen });
  g = take(g, (a) => a.type === "ACTIVATE_ABILITY"); // a Mountain, while paying
  return answer(g, { kind: "payMana", payment: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 } });
}

describe("an activated ability with a target (CR 602.2b, 601.2c)", () => {
  it("goes on the stack with its target and deals its damage on resolution, with its source as the source", () => {
    const { game, pinger, bears } = setup();
    let g = ping(game, pinger, bears);
    const ability = g.state.zones.stack[0] as ObjectId;
    expect(g.state.objects[ability]).toMatchObject({ kind: "ability", source: pinger });
    expect(g.events.some((e) => e.type === "ABILITY_ACTIVATED" && e.object === ability)).toBe(true);
    g = passBoth(g);
    expect(g.state.objects[bears]).toMatchObject({ damage: 1 });
    expect(g.events.find((e) => e.type === "DAMAGE_DEALT")).toMatchObject({ source: pinger, combat: false });
  });

  it("doesn't resolve if its only target became illegal, and is removed from the stack (CR 608.2b)", () => {
    const { game, pinger, bears } = setup();
    const g0 = ping(game, pinger, bears);
    const moved: Game = { state: moveCard(g0.state, bears, { zone: "graveyard" }).state, events: g0.events };
    const g = passBoth(moved);
    expect(g.state.zones.stack).toStrictEqual([]);
    expect(g.events.some((e) => e.type === "ABILITY_DID_NOT_RESOLVE" && e.source === pinger)).toBe(true);
    expect(g.events.some((e) => e.type === "DAMAGE_DEALT")).toBe(false);
  });

  it("still deals its damage after its source has left the battlefield (CR 113.7a)", () => {
    const { game, pinger } = setup();
    const g0 = ping(game, pinger, "p2");
    const moved: Game = { state: moveCard(g0.state, pinger, { zone: "graveyard" }).state, events: g0.events };
    const g = passBoth(moved);
    expect(g.state.players.p2?.life).toBe(19);
  });
});

describe("activating and priority (CR 117.3c, 117.4)", () => {
  /** p1's main phase; p2 has a Pinger and a Mountain. */
  function p2Pinger(): { game: Game; pinger: ObjectId } {
    const game = start({
      seed: 1,
      players: [
        playerSetup("p1", { library: ["forest"] }),
        playerSetup("p2", { library: ["forest"], battlefield: [permanent(PINGER), permanent("mountain")] }),
      ],
      opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
      ruleModifiers: [],
    });
    return { game, pinger: game.state.zones.battlefield[0] as ObjectId };
  }

  it("restarts the passes, and the activating player gets priority", () => {
    // p1 passes in their main phase; p2 then activates their Pinger, so p1's pass no longer counts.
    const { game, pinger } = p2Pinger();
    let g = take(game, (a) => a.type === "PASS_PRIORITY");
    expect(g.state.passesInSuccession).toBe(1);
    g = take(g, isPing(pinger));
    g = answer(g, { kind: "chooseTarget", target: { kind: "player", player: "p1" } });
    g = take(g, (a) => a.type === "ACTIVATE_ABILITY");
    g = answer(g, { kind: "payMana", payment: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 } });
    expect(g.state.passesInSuccession).toBe(0);
    expect(g.state.pending).toMatchObject({ player: "p2", kind: "priority" });
    g = passBoth(g);
    expect(g.state.players.p1?.life).toBe(19);
    expect(g.state.turn?.step).toBe("precombatMain");
  });

  it("offers only mana abilities and cancelling while paying; cancelling doesn't restart the passes", () => {
    const { game, pinger } = p2Pinger();
    let g = take(game, (a) => a.type === "PASS_PRIORITY"); // p1 passes
    g = take(g, isPing(pinger));
    g = answer(g, { kind: "chooseTarget", target: { kind: "player", player: "p1" } });
    expect(g.state.pending?.kind).toBe("payMana");
    expect(legalActions(g.state, "p2", TEST_CARDS).some(isPing(pinger))).toBe(false);
    g = answer(g, { kind: "cancelCast" });
    expect(g.state.zones.stack).toStrictEqual([]);
    expect(g.events.some((e) => e.type === "ACTIVATION_CANCELLED")).toBe(true);
    // Cancelling isn't an action (D-035): p1's pass still counts, so p2's pass ends the step.
    expect(g.state.passesInSuccession).toBe(1);
    g = take(g, (a) => a.type === "PASS_PRIORITY");
    expect(g.state.turn?.step).toBe("beginningOfCombat");
  });
});
