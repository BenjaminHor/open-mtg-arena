// Casting details the scenarios can't reach yet. CR 608.2b needs a target to become illegal, which in this pool takes
// damage (M1-10) and a creature dying (M1-12); until then the target is moved away directly. The YAML scenario for it
// is part of M1-12's acceptance.

import { describe, expect, it } from "vitest";
import { type Action, type GameState, legalActions, type ObjectId } from "../../src/index.ts";
import { moveCard } from "../../src/zones/move-card.ts";
import { TEST_CARDS } from "../support/cards.ts";
import { act, type Game, playerSetup, start } from "../support/game.ts";

function setup(): Game {
  return start({
    seed: 1,
    players: [
      playerSetup("p1", {
        library: ["forest"],
        hand: ["shock"],
        battlefield: [{ oracleId: "mountain", tapped: false, summoningSick: false, damage: 0, counters: {} }],
      }),
      playerSetup("p2", {
        library: ["forest"],
        battlefield: [{ oracleId: "grizzly-bears", tapped: false, summoningSick: false, damage: 0, counters: {} }],
      }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  });
}

/** The first legal action matching. */
function take(game: Game, match: (a: Action) => boolean): Game {
  const pending = game.state.pending;
  if (pending === null) throw new Error("nothing pending");
  const action = legalActions(game.state, pending.player, TEST_CARDS).find(match);
  if (action === undefined) throw new Error("no such legal action");
  return act(game, action);
}

/** p1 casts Shock at p2's Grizzly Bears, paying with the Mountain. */
function shockTheBears(): { game: Game; bears: ObjectId } {
  let game = setup();
  const bears = game.state.zones.battlefield[1] as ObjectId;
  game = take(game, (a) => a.type === "CAST_SPELL");
  game = take(
    game,
    (a) => a.type === "ANSWER" && a.answer.kind === "chooseTarget" && a.answer.target.kind === "object",
  );
  game = take(game, (a) => a.type === "ACTIVATE_ABILITY");
  game = take(game, (a) => a.type === "ANSWER" && a.answer.kind === "payMana");
  return { game, bears };
}

const passBoth = (game: Game) =>
  take(
    take(game, (a) => a.type === "PASS_PRIORITY"),
    (a) => a.type === "PASS_PRIORITY",
  );

describe("a spell whose targets are all illegal (CR 608.2b)", () => {
  it("doesn't resolve, goes to its owner's graveyard, and the active player gets priority", () => {
    const { game, bears } = shockTheBears();
    const shock = game.state.zones.stack[0] as ObjectId;
    // The target leaves the battlefield: it's a new object now (CR 400.7), so the old target is illegal.
    const moved: Game = { state: moveCard(game.state, bears, { zone: "graveyard" }).state, events: game.events };
    const after = passBoth(moved);
    expect(after.state.zones.stack).toStrictEqual([]);
    expect(after.state.zones.players.p1?.graveyard).toHaveLength(1);
    expect(after.events.some((e) => e.type === "SPELL_DID_NOT_RESOLVE" && e.object === shock)).toBe(true);
    expect(after.events.some((e) => e.type === "SPELL_RESOLVED")).toBe(false);
    expect(after.state.pending).toMatchObject({ player: "p1", kind: "priority" });
  });

  it("resolves normally while its target is still legal", () => {
    const { game } = shockTheBears();
    const after = passBoth(game);
    expect(after.events.some((e) => e.type === "SPELL_RESOLVED")).toBe(true);
    expect(after.events.some((e) => e.type === "SPELL_DID_NOT_RESOLVE")).toBe(false);
  });
});

describe("cancelling a cast (CR 734.1)", () => {
  it("restores the card as the very same object, in the same place, with nothing triggered", () => {
    let game = setup();
    const before: GameState = game.state;
    game = take(game, (a) => a.type === "CAST_SPELL");
    game = take(game, (a) => a.type === "ANSWER" && a.answer.kind === "chooseTarget");
    game = take(game, (a) => a.type === "ACTIVATE_ABILITY");
    game = take(game, (a) => a.type === "ANSWER" && a.answer.kind === "cancelCast");
    expect(game.state.zones).toStrictEqual(before.zones);
    expect(game.state.objects).toStrictEqual(before.objects);
    expect(game.state.players).toStrictEqual(before.players);
    expect(game.state.casting).toBeNull();
  });
});
