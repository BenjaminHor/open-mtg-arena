// The legend rule (CR 704.5j): a player with two or more legendary permanents of the same name keeps one, chosen before
// the check, and the rest go to the graveyard with the check's other state-based actions (CR 704.3). No legendary
// permanent is in the pool yet, so test cards stand in.

import { describe, expect, it } from "vitest";
import { cleanupCheck } from "../../src/game/steps.ts";
import {
  applyAction,
  type CardObject,
  type GameState,
  type ObjectId,
  type PermanentSetup,
  type PlayerId,
} from "../../src/index.ts";
import { BEARS, CONTROL_AURA, LEGEND, OTHER_LEGEND, TEST_CARDS } from "../support/cards.ts";
import { answer, type Game, playerSetup, start } from "../support/game.ts";

const permanent = (oracleId: string, damage = 0): PermanentSetup => ({
  oracleId,
  tapped: false,
  summoningSick: false,
  damage,
  counters: {},
});

/** A game in `active`'s precombat main phase, waiting for whatever comes before their priority. */
function board(mine: PermanentSetup[], theirs: PermanentSetup[], active: PlayerId = "p1"): Game {
  return start({
    seed: 1,
    players: [
      playerSetup("p1", { library: ["forest", "forest"], battlefield: mine }),
      playerSetup("p2", { library: ["forest", "forest"], battlefield: theirs }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: active, step: "precombatMain" } },
    ruleModifiers: [],
  });
}

const graveyard = (state: GameState, player: PlayerId) => state.zones.players[player]?.graveyard ?? [];

describe("the legend rule (CR 704.5j)", () => {
  it("asks the controller of two legendary permanents with the same name which to keep; the other goes (CR 205.4d)", () => {
    let game = board([permanent(LEGEND), permanent(LEGEND)], []);
    const [first, second] = game.state.zones.battlefield as [ObjectId, ObjectId];
    expect(game.state.pending).toMatchObject({ player: "p1", kind: "keepLegend", options: [first, second] });
    game = answer(game, { kind: "chooseCard", option: 1 });
    expect(game.state.zones.battlefield).toStrictEqual([second]);
    expect(graveyard(game.state, "p1")).toHaveLength(1);
    expect(game.events).toContainEqual({
      type: "STATE_BASED_ACTIONS",
      actions: [{ kind: "legendRule", object: first }],
    });
    expect(game.state.pending).toMatchObject({ player: "p1", kind: "priority" });
  });

  it("doesn't apply to legendary permanents with different names, or to the same name under different players", () => {
    for (const game of [
      board([permanent(LEGEND), permanent(OTHER_LEGEND)], []),
      board([permanent(LEGEND)], [permanent(LEGEND)]),
    ]) {
      expect(game.state.pending?.kind).toBe("priority");
      expect(game.state.zones.battlefield).toHaveLength(2);
    }
  });

  it("asks the active player first, then the others, and puts every unkept one into the graveyard at once (CR 101.4)", () => {
    let game = board([permanent(LEGEND), permanent(LEGEND)], [permanent(LEGEND), permanent(LEGEND)], "p2");
    const [p1a, p1b, p2a, p2b] = game.state.zones.battlefield as [ObjectId, ObjectId, ObjectId, ObjectId];
    expect(game.state.pending).toMatchObject({ player: "p2", kind: "keepLegend", options: [p2a, p2b] });
    game = answer(game, { kind: "chooseCard", option: 0 });
    expect(game.state.pending).toMatchObject({ player: "p1", kind: "keepLegend", options: [p1a, p1b], kept: [p2a] });
    // Nothing has happened yet: the check waits for every choice.
    expect(game.state.zones.battlefield).toHaveLength(4);
    game = answer(game, { kind: "chooseCard", option: 1 });
    expect(game.state.zones.battlefield).toStrictEqual([p1b, p2a]);
    const checks = game.events.filter((e) => e.type === "STATE_BASED_ACTIONS");
    expect(checks).toStrictEqual([
      {
        type: "STATE_BASED_ACTIONS",
        actions: [
          { kind: "legendRule", object: p1a },
          { kind: "legendRule", object: p2b },
        ],
      },
    ]);
  });

  it("happens together with the check's other state-based actions: keeping a doomed legend loses both (CR 704.3)", () => {
    let game = board([permanent(LEGEND, 2), permanent(LEGEND), permanent(BEARS, 2)], []);
    const [doomed, healthy, bears] = game.state.zones.battlefield as [ObjectId, ObjectId, ObjectId];
    expect(game.state.pending).toMatchObject({ kind: "keepLegend", options: [doomed, healthy] });
    game = answer(game, { kind: "chooseCard", option: 0 });
    expect(game.state.zones.battlefield).toStrictEqual([]);
    const check = game.events.find((e) => e.type === "STATE_BASED_ACTIONS");
    expect(check?.type === "STATE_BASED_ACTIONS" && check.actions).toStrictEqual([
      { kind: "lethalDamage", object: doomed },
      { kind: "lethalDamage", object: bears },
      { kind: "legendRule", object: healthy },
    ]);
  });

  it("puts an unkept legend with lethal damage into the graveyard, not destroyed: regeneration can't save it (CR 614.8)", () => {
    let game = board([permanent(LEGEND, 2), permanent(LEGEND)], []);
    const [doomed, healthy] = game.state.zones.battlefield as [ObjectId, ObjectId];
    const shield = { kind: "regenerationShield" as const, object: doomed };
    game = { ...game, state: { ...game.state, replacements: [shield] } };
    game = answer(game, { kind: "chooseCard", option: 1 });
    expect(game.state.zones.battlefield).toStrictEqual([healthy]);
    const check = game.events.find((e) => e.type === "STATE_BASED_ACTIONS");
    expect(check?.type === "STATE_BASED_ACTIONS" && check.actions).toStrictEqual([
      { kind: "legendRule", object: doomed },
    ]);
    expect(game.events.some((e) => e.type === "PERMANENT_REGENERATED")).toBe(false);
  });

  it("keeps one of three, and asks once per set (CR 704.5j)", () => {
    let game = board([permanent(LEGEND), permanent(LEGEND), permanent(LEGEND)], []);
    const [, middle] = game.state.zones.battlefield as [ObjectId, ObjectId, ObjectId];
    game = answer(game, { kind: "chooseCard", option: 1 });
    expect(game.state.zones.battlefield).toStrictEqual([middle]);
    expect(graveyard(game.state, "p1")).toHaveLength(2);
    expect(game.state.pending?.kind).toBe("priority");
  });

  it("refuses an option that isn't there, changing nothing", () => {
    const game = board([permanent(LEGEND), permanent(LEGEND)], []);
    const decisionId = game.state.pending?.id ?? "d0";
    for (const answer of [
      { kind: "chooseCard", option: 2 },
      { kind: "chooseYesNo", yes: true },
    ] as const) {
      const result = applyAction(game.state, { type: "ANSWER", decisionId, player: "p1", answer }, TEST_CARDS);
      expect(result.ok).toBe(false);
    }
  });

  it("puts an unkept legend its controller doesn't own into its owner's graveyard (CR 704.5j)", () => {
    // p1 controls p2's Test Legend through a control Aura, and their own.
    const stolen = { ...permanent(CONTROL_AURA), attachedTo: { player: "p2" as const, index: 0 } };
    let game = board([permanent(LEGEND), stolen], [permanent(LEGEND)]);
    const [mine, , theirs] = game.state.zones.battlefield as [ObjectId, ObjectId, ObjectId];
    expect(game.state.pending).toMatchObject({ player: "p1", kind: "keepLegend", options: [mine, theirs] });
    game = answer(game, { kind: "chooseCard", option: 0 });
    expect(graveyard(game.state, "p2")).toHaveLength(1);
    expect(graveyard(game.state, "p1")).toHaveLength(1); // the control Aura, attached to nothing now (CR 704.5m)
  });

  it("is asked in the cleanup step too: then the active player gets priority (CR 514.3a)", () => {
    const game = board([permanent(LEGEND)], []);
    const [first] = game.state.zones.battlefield as [ObjectId];
    // A second copy arrives without a check in between, as when a control effect ends in cleanup (CR 514.2).
    const second = { ...(game.state.objects[first] as CardObject), id: "o99" as ObjectId };
    const state = {
      ...game.state,
      objects: { ...game.state.objects, o99: second },
      zones: { ...game.state.zones, battlefield: [first, "o99" as ObjectId] },
    };
    expect(cleanupCheck(state, TEST_CARDS).state.work).toStrictEqual([{ kind: "givePriority", player: "p1" }]);
    // With no set, the step ends with no one getting priority (CR 514.3).
    expect(cleanupCheck(game.state, TEST_CARDS).state.work).toStrictEqual([{ kind: "endStep" }]);
  });
});
