// Attachments below the scenarios (cards/m2-12a): the setup that starts a permanent attached, and the one reader of
// what a permanent is attached to.

import { describe, expect, it } from "vitest";
import { setupProblems } from "../../src/game/setup-validation.ts";
import type { GameSetup, GameState, ObjectId } from "../../src/index.ts";
import { attachedHost, attachmentsOf } from "../../src/rules/attachment.ts";
import type { PermanentSetup } from "../../src/state/setup.ts";
import { moveCard } from "../../src/zones/move-card.ts";
import { BEARS, TEST_CARDS } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

const permanent = (attachedTo?: PermanentSetup["attachedTo"]): PermanentSetup => ({
  oracleId: BEARS,
  tapped: false,
  summoningSick: false,
  damage: 0,
  counters: {},
  ...(attachedTo === undefined ? {} : { attachedTo }),
});

function setup(p1: PermanentSetup[], p2: PermanentSetup[] = []): GameSetup {
  return {
    seed: 1,
    players: [
      playerSetup("p1", { library: ["forest"], battlefield: p1 }),
      playerSetup("p2", { library: ["forest"], battlefield: p2 }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  };
}

describe("a setup can start a permanent attached (CR 303.4b, 301.5a)", () => {
  it("attaches it to the permanent named by player and index, an opponent's too", () => {
    const state = start(setup([permanent(), permanent({ player: "p2", index: 0 })], [permanent()])).state;
    const [, attached, theirs] = state.zones.battlefield as [ObjectId, ObjectId, ObjectId];
    expect(attachedHost(state, attached)).toBe(theirs);
    expect(attachmentsOf(state, theirs)).toStrictEqual([attached]);
  });

  it("refuses a permanent attached to nothing, or to itself (CR 303.4d, 301.5c)", () => {
    expect(setupProblems(setup([permanent({ player: "p2", index: 0 })]), TEST_CARDS)).toStrictEqual([
      "p1: a permanent is attached to nothing on p2's battlefield",
    ]);
    expect(setupProblems(setup([permanent({ player: "p1", index: 0 })]), TEST_CARDS)).toStrictEqual([
      "p1: a permanent can't be attached to itself (CR 303.4d)",
    ]);
  });
});

describe("what a permanent is attached to is read only while that object is on the battlefield (CR 400.7)", () => {
  it("is nothing once the host has left, though the stale id stays on the object", () => {
    const state: GameState = start(setup([permanent(), permanent({ player: "p1", index: 0 })])).state;
    const [host, attached] = state.zones.battlefield as [ObjectId, ObjectId];
    const moved = moveCard(state, host, { zone: "graveyard" }).state;
    expect(attachedHost(moved, attached)).toBeNull();
    const obj = moved.objects[attached];
    expect(obj?.kind === "card" && obj.attachedTo).toBe(host);
  });

  it("is fresh on a new object: an attached permanent that moves comes back attached to nothing", () => {
    const state: GameState = start(setup([permanent(), permanent({ player: "p1", index: 0 })])).state;
    const [, attached] = state.zones.battlefield as [ObjectId, ObjectId];
    const gone = moveCard(state, attached, { zone: "hand" });
    const back = moveCard(gone.state, gone.newId, { zone: "battlefield", controller: "p1" });
    const obj = back.state.objects[back.newId];
    expect(obj?.kind === "card" && obj.attachedTo).toBeUndefined();
  });
});
