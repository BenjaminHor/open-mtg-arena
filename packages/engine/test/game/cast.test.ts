// Casting details, checked directly. The target is moved away by hand here; the YAML scenario
// casting/target-died-does-not-resolve.yaml shows CR 608.2b with a creature that really died.

import { describe, expect, it } from "vitest";
import { cancelCasting } from "../../src/game/casting-steps.ts";
import type { GameState, ObjectId } from "../../src/index.ts";
import type { PendingTrigger } from "../../src/state/triggers.ts";
import { moveCard } from "../../src/zones/move-card.ts";
import { BEARS, SPLIT } from "../support/cards.ts";
import { type Game, passBoth, playerSetup, start, take } from "../support/game.ts";

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

  it("keeps the triggers that were waiting as the cast began, and drops those it made (CR 734.1)", () => {
    // From priority none can be waiting (CR 117.5), but a cast while something resolves may begin with some (CR 608.2g):
    // set here by hand, as no pool card reaches it.
    let game = setup();
    game = take(game, (a) => a.type === "CAST_SPELL");
    const casting = game.state.casting;
    if (casting === null) throw new Error("not casting");
    const waiting: PendingTrigger = {
      source: game.state.zones.battlefield[0] as ObjectId,
      sourceOracleId: "mountain",
      ref: { kind: "triggered", index: 0 },
      controller: "p1",
      event: { type: "TURN_BEGAN", player: "p1", turn: 3, extra: false },
    } as unknown as PendingTrigger;
    const made = { ...waiting, controller: "p2" } as PendingTrigger;
    const state = {
      ...game.state,
      casting: { ...casting, triggersBefore: [waiting] },
      pendingTriggers: [waiting, made],
    };
    expect(cancelCasting(state).state.pendingTriggers).toStrictEqual([waiting]);
  });

  /** p1 can cast Split (2 damage divided among one or more target creatures) at p2's two Grizzly Bears. */
  function splitSetup(): Game {
    const permanent = (oracleId: string) => ({
      oracleId,
      tapped: false,
      summoningSick: false,
      damage: 0,
      counters: {},
    });
    return start({
      seed: 1,
      players: [
        playerSetup("p1", { library: ["forest"], hand: [SPLIT], battlefield: [permanent("mountain")] }),
        playerSetup("p2", { library: ["forest"], battlefield: [permanent(BEARS), permanent(BEARS)] }),
      ],
      opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
      ruleModifiers: [],
    });
  }

  const restored = (game: Game, before: GameState) => {
    expect(game.state.zones).toStrictEqual(before.zones);
    expect(game.state.objects).toStrictEqual(before.objects);
    expect(game.state.players).toStrictEqual(before.players);
    expect(game.state.casting).toBeNull();
  };

  it("restores everything when cancelled while announcing the number of targets", () => {
    let game = splitSetup();
    const before = game.state;
    game = take(game, (a) => a.type === "CAST_SPELL");
    expect(game.state.pending?.kind).toBe("chooseTargetCount");
    restored(
      take(game, (a) => a.type === "ANSWER" && a.answer.kind === "cancelCast"),
      before,
    );
  });

  it("restores everything when cancelled while dividing, after the targets are chosen", () => {
    let game = splitSetup();
    const before = game.state;
    game = take(game, (a) => a.type === "CAST_SPELL");
    game = take(game, (a) => a.type === "ANSWER" && a.answer.kind === "chooseTargetCount" && a.answer.count === 2);
    game = take(game, (a) => a.type === "ANSWER" && a.answer.kind === "chooseTarget");
    game = take(game, (a) => a.type === "ANSWER" && a.answer.kind === "chooseTarget");
    expect(game.state.pending?.kind).toBe("divide");
    restored(
      take(game, (a) => a.type === "ANSWER" && a.answer.kind === "cancelCast"),
      before,
    );
  });
});
