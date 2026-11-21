// The legend rule (CR 704.5j): a player with two or more legendary permanents of the same name keeps one, chosen before
// the check, and the rest go to the graveyard with the check's other state-based actions (CR 704.3). No legendary
// permanent is in the pool yet, so test cards stand in.

import { describe, expect, it } from "vitest";
import type { GameState, ObjectId, PlayerId } from "../../src/index.ts";
import { BEARS, LEGEND, OTHER_LEGEND } from "../support/cards.ts";
import { answer, type Game, playerSetup, start } from "../support/game.ts";

const permanent = (oracleId: string, damage = 0) => ({
  oracleId,
  tapped: false,
  summoningSick: false,
  damage,
  counters: {},
});

/** A game in `active`'s precombat main phase, waiting for whatever comes before their priority. */
function board(
  mine: ReturnType<typeof permanent>[],
  theirs: ReturnType<typeof permanent>[],
  active: PlayerId = "p1",
): Game {
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
  it("asks the controller of two legendary permanents with the same name which to keep; the other goes", () => {
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

  it("puts an unkept legend that's dying anyway into the graveyard once, as it dies (CR 704.3)", () => {
    let game = board([permanent(LEGEND, 2), permanent(LEGEND)], []);
    const [doomed, healthy] = game.state.zones.battlefield as [ObjectId, ObjectId];
    game = answer(game, { kind: "chooseCard", option: 1 });
    expect(game.state.zones.battlefield).toStrictEqual([healthy]);
    const check = game.events.find((e) => e.type === "STATE_BASED_ACTIONS");
    expect(check?.type === "STATE_BASED_ACTIONS" && check.actions).toStrictEqual([
      { kind: "lethalDamage", object: doomed },
    ]);
  });
});
