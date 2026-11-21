// Attaching and unattaching (CR 701.3), and the state-based action for Equipment (CR 704.5n), below the scenarios
// (cards/m2-12b): what no M10 card can show, as a black Equipment on a creature with protection from black.

import { describe, expect, it } from "vitest";
import { attachSelf } from "../../src/effects/attach-self.ts";
import { checkStateBasedActions } from "../../src/game/state-based-actions.ts";
import type { GameSetup, GameState, ObjectId } from "../../src/index.ts";
import { attach, unattach } from "../../src/permanents/attach.ts";
import { attachedHost } from "../../src/rules/attachment.ts";
import type { PermanentSetup } from "../../src/state/setup.ts";
import { BEARS, BLACK_EQUIPMENT, PRO_BLACK, TEST_CARDS } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

const permanent = (oracleId: string, attachedTo?: PermanentSetup["attachedTo"]): PermanentSetup => ({
  oracleId,
  tapped: false,
  summoningSick: false,
  damage: 0,
  counters: {},
  ...(attachedTo === undefined ? {} : { attachedTo }),
});

/** p1: Grizzly Bears, a creature with protection from black, and the black Equipment on the Bears (or on `host`). */
function board(host = 0): { state: GameState; bears: ObjectId; proBlack: ObjectId; equipment: ObjectId } {
  const setup: GameSetup = {
    seed: 1,
    players: [
      playerSetup("p1", {
        library: ["forest"],
        battlefield: [
          permanent(BEARS),
          permanent(PRO_BLACK),
          permanent(BLACK_EQUIPMENT, { player: "p1", index: host }),
        ],
      }),
      playerSetup("p2", { library: ["forest"] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  };
  const state = start(setup).state;
  const [bears, proBlack, equipment] = state.zones.battlefield as [ObjectId, ObjectId, ObjectId];
  return { state, bears, proBlack, equipment };
}

describe("attaching (CR 701.3)", () => {
  it("moves the Equipment onto another creature, with a new timestamp (CR 701.3a, 701.3c, 613.7e)", () => {
    const { state, equipment, proBlack, bears } = board();
    const before = state.objects[equipment];
    const done = attach(state, equipment, proBlack);
    const after = done.state.objects[equipment];
    expect(attachedHost(done.state, equipment)).toBe(proBlack);
    expect(after?.timestamp).toBeGreaterThan(before?.timestamp ?? Number.POSITIVE_INFINITY);
    expect(done.events).toStrictEqual([{ type: "ATTACHED", object: equipment, to: proBlack, from: bears }]);
  });

  it("does nothing when it's already attached there, not even a new timestamp (CR 701.3b)", () => {
    const { state, equipment, bears } = board();
    expect(attach(state, equipment, bears)).toStrictEqual({ state, events: [] });
  });

  it("unattaching leaves it on the battlefield with no `attachedTo` key at all, as plain JSON (CR 701.3d)", () => {
    const { state, equipment, bears } = board();
    const done = unattach(state, equipment);
    expect(done.state.zones.battlefield).toContain(equipment);
    expect(Object.keys(done.state.objects[equipment] ?? {})).not.toContain("attachedTo");
    expect(done.events).toStrictEqual([{ type: "UNATTACHED", object: equipment, from: bears }]);
    expect(unattach(done.state, equipment)).toStrictEqual({ state: done.state, events: [] });
  });
});

describe("protection from the Equipment's quality (CR 702.16d)", () => {
  it("can't be equipped by it: equip leaves the Equipment where it is (CR 701.3b)", () => {
    const { state, equipment, proBlack, bears } = board();
    const context = {
      self: equipment,
      controller: "p1" as const,
      targets: [[{ kind: "object" as const, object: proBlack }]],
      division: [],
      x: null,
      trigger: null,
    };
    const done = attachSelf(state, { target: 0 }, context, TEST_CARDS);
    expect(attachedHost(done.state, equipment)).toBe(bears);
  });

  it("an Equipment attached to itself becomes unattached too (CR 301.5c, 704.5n)", () => {
    const { state, equipment } = board();
    const obj = state.objects[equipment];
    if (obj?.kind !== "card") throw new Error("no Equipment");
    const self = { ...state, objects: { ...state.objects, [equipment]: { ...obj, attachedTo: equipment } } };
    expect(attachedHost(checkStateBasedActions(self, TEST_CARDS).state, equipment)).toBeNull();
  });

  it("an Equipment already on it becomes unattached as a state-based action, and stays (CR 704.5n)", () => {
    const { state, equipment } = board(1);
    const checked = checkStateBasedActions(state, TEST_CARDS);
    expect(attachedHost(checked.state, equipment)).toBeNull();
    expect(checked.state.zones.battlefield).toContain(equipment);
  });
});
