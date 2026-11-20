// The effects interpreter (effects/README.md), for what the YAML scenarios can't reach: a target becoming illegal
// before resolution (only damage and dying do that in the M1 pool, and dying is M1-12), a spell with two instances of
// "target", and 0 damage.

import { describe, expect, it } from "vitest";
import { runEffect } from "../../src/effects/run-effect.ts";
import { type Action, type GameState, legalActions, type ObjectId } from "../../src/index.ts";
import { happen } from "../../src/pipeline/happen.ts";
import type { Damage } from "../../src/pipeline/proposed.ts";
import { moveCard } from "../../src/zones/move-card.ts";
import { BITE, GROWTH, SHOT_AND_BOOST, TEST_CARDS } from "../support/cards.ts";
import { act, type Game, passBoth, playerSetup, start, take } from "../support/game.ts";

const permanent = (oracleId: string) => ({ oracleId, tapped: false, summoningSick: false, damage: 0, counters: {} });

/** p1, in their main phase with a Mountain and a Forest, holds `spell`; p2 has a Grizzly Bears. */
function setup(spell: string): { game: Game; bears: ObjectId } {
  const game = start({
    seed: 1,
    players: [
      playerSetup("p1", {
        library: ["forest"],
        hand: [spell],
        battlefield: [permanent("mountain"), permanent("forest")],
      }),
      playerSetup("p2", { library: ["forest"], battlefield: [permanent("grizzly-bears")] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  });
  return { game, bears: game.state.zones.battlefield[2] as ObjectId };
}

const targetIs = (want: string) => (a: Action) =>
  a.type === "ANSWER" &&
  a.answer.kind === "chooseTarget" &&
  (a.answer.target.kind === "player" ? a.answer.target.player : a.answer.target.object) === want;

/** p1 casts their spell at these targets, paying with whichever land works, and it's on the stack. */
function cast(game: Game, targets: string[]): Game {
  let g = take(game, (a) => a.type === "CAST_SPELL");
  for (const t of targets) g = take(g, targetIs(t));
  while (g.state.pending?.kind === "payMana") {
    const pay = legalActions(g.state, "p1", TEST_CARDS).find((a) => a.type === "ANSWER" && a.answer.kind === "payMana");
    g = pay !== undefined ? act(g, pay) : take(g, (a) => a.type === "ACTIVATE_ABILITY");
  }
  return g;
}

/** The target leaves the battlefield: it's a new object now (CR 400.7), so the old target is illegal. */
const removed = (game: Game, id: ObjectId): Game => ({
  state: moveCard(game.state, id, { zone: "graveyard" }).state,
  events: game.events,
});

describe("CR 608.2b: illegal targets aren't affected", () => {
  it("skips the illegal target but still affects the legal one", () => {
    const { game, bears } = setup(SHOT_AND_BOOST);
    const after = passBoth(removed(cast(game, ["p2", bears]), bears));
    expect(after.state.players.p2?.life).toBe(19);
    expect(after.state.effects).toStrictEqual([]);
    expect(after.events.some((e) => e.type === "SPELL_RESOLVED")).toBe(true);
  });

  it("affects both when both are legal, in the order written (CR 608.2c), with the spell as the source", () => {
    const { game, bears } = setup(SHOT_AND_BOOST);
    const onStack = cast(game, ["p2", bears]);
    const spell = onStack.state.zones.stack[0] as ObjectId;
    const after = passBoth(onStack);
    expect(after.state.players.p2?.life).toBe(19);
    expect(after.state.effects.map((e) => e.affected)).toStrictEqual([[bears]]);
    const types = after.events.map((e) => e.type).filter((t) => t === "DAMAGE_DEALT" || t === "EFFECT_CREATED");
    expect(types).toStrictEqual(["DAMAGE_DEALT", "EFFECT_CREATED"]);
    // The spell says which object deals the damage: itself (CR 120.2b).
    expect(after.events.find((e) => e.type === "DAMAGE_DEALT")).toMatchObject({ source: spell });
  });

  it("doesn't resolve when every instance's target is illegal, even with two instances of \"target\"", () => {
    const { game, bears } = setup(SHOT_AND_BOOST);
    const after = passBoth(removed(cast(game, [bears, bears]), bears));
    expect(after.events.some((e) => e.type === "SPELL_DID_NOT_RESOLVE")).toBe(true);
    expect(after.events.some((e) => e.type === "DAMAGE_DEALT" || e.type === "EFFECT_CREATED")).toBe(false);
    expect(after.state.zones.players.p1?.graveyard).toHaveLength(1);
  });

  it('can affect the same object through two instances of "target" (CR 115.3)', () => {
    const { game, bears } = setup(SHOT_AND_BOOST);
    const after = passBoth(cast(game, [bears, bears]));
    expect(after.state.objects[bears]).toMatchObject({ damage: 1 });
    expect(after.state.effects.map((e) => e.affected)).toStrictEqual([[bears]]);
  });

  it("deals no damage when the damage's source was an illegal target, but still resolves", () => {
    // CR 608.2b: "If part of the effect requires information about an illegal target, it fails to determine any such
    // information. Any part of the effect that requires that information won't happen."
    const { game, bears } = setup(BITE);
    const after = passBoth(removed(cast(game, [bears, "p2"]), bears));
    expect(after.events.some((e) => e.type === "DAMAGE_DEALT")).toBe(false);
    expect(after.state.players.p2?.life).toBe(20);
    expect(after.events.some((e) => e.type === "SPELL_RESOLVED")).toBe(true);
  });

  it("creates no effect for an illegal target", () => {
    const { game, bears } = setup(GROWTH);
    const after = passBoth(removed(cast(game, [bears]), bears));
    expect(after.state.effects).toStrictEqual([]);
    expect(after.events.some((e) => e.type === "EFFECT_CREATED")).toBe(false);
  });
});

describe("continuous effects (CR 611.2)", () => {
  it("records the source, controller, a new timestamp and the affected object (CR 611.2c, 613.7b)", () => {
    const { game, bears } = setup(GROWTH);
    const onStack = cast(game, [bears]);
    const spell = onStack.state.zones.stack[0] as ObjectId;
    const timestamp = onStack.state.nextTimestamp;
    const after = passBoth(onStack);
    expect(after.state.effects).toStrictEqual([
      {
        source: spell,
        controller: "p1",
        timestamp,
        duration: "endOfTurn",
        affected: [bears],
        change: { kind: "modifyPT", power: 3, toughness: 3 },
      },
    ]);
    // The effect took that timestamp; the card going to the graveyard afterwards gets the next one (CR 613.7d).
    const growth = after.state.zones.players.p1?.graveyard[0] as ObjectId;
    expect(after.state.objects[growth]?.timestamp).toBe(timestamp + 1);
  });
});

describe("an effect on an object that's gone", () => {
  it("isn't created for an object that left the battlefield after resolution began (CR 101.3)", () => {
    const { game } = setup(GROWTH);
    const forest = game.state.zones.battlefield[0] as ObjectId;
    const gone = moveCard(game.state, forest, { zone: "graveyard" }).state;
    const result = runEffect(
      gone,
      { op: "modifyPT", power: 3, toughness: 3, of: { target: 0 }, duration: "endOfTurn" },
      {
        self: forest,
        controller: "p1",
        targets: [[{ kind: "object", object: forest }]],
        division: [],
        x: null,
        trigger: null,
      },
      TEST_CARDS,
    );
    expect(result.state.effects).toStrictEqual([]);
    expect(result.events).toStrictEqual([]);
  });
});

describe("dealing damage (CR 120)", () => {
  it("deals no damage at all when the amount is 0 (CR 120.8)", () => {
    const { game, bears } = setup(GROWTH);
    const state: GameState = game.state;
    const result = dealDamage(
      state,
      [
        { source: bears, to: { kind: "player", player: "p2" }, amount: 0, combat: false },
        { source: bears, to: { kind: "object", object: bears }, amount: 0, combat: false },
      ],
      TEST_CARDS,
    );
    expect(result.events).toStrictEqual([]);
    expect(result.state).toStrictEqual(state);
  });

  it("deals damage to several recipients in one event, each with its result (CR 120.4, 510.2)", () => {
    const { game, bears } = setup(GROWTH);
    const result = dealDamage(
      game.state,
      [
        { source: bears, to: { kind: "player", player: "p1" }, amount: 2, combat: false },
        { source: bears, to: { kind: "object", object: bears }, amount: 1, combat: false },
      ],
      TEST_CARDS,
    );
    // All the damage is dealt first (CR 120.4b), then turned into its results (CR 120.4c).
    expect(result.events.map((e) => e.type)).toStrictEqual(["DAMAGE_DEALT", "DAMAGE_DEALT", "LIFE_LOST"]);
    expect(result.state.players.p1?.life).toBe(18);
    expect(result.state.objects[bears]).toMatchObject({ damage: 1 });
  });

  it("deals no damage to a creature that has left the battlefield", () => {
    const { game, bears } = setup(GROWTH);
    const gone = moveCard(game.state, bears, { zone: "graveyard" }).state;
    const result = dealDamage(
      gone,
      [{ source: bears, to: { kind: "object", object: bears }, amount: 3, combat: false }],
      TEST_CARDS,
    );
    expect(result.events).toStrictEqual([]);
    expect(result.state).toStrictEqual(gone);
  });

  it("deals no damage to a permanent that isn't a creature (CR 120.1a)", () => {
    const { game, bears } = setup(GROWTH);
    const mountain = game.state.zones.battlefield[0] as ObjectId;
    const result = dealDamage(
      game.state,
      [{ source: bears, to: { kind: "object", object: mountain }, amount: 3, combat: false }],
      TEST_CARDS,
    );
    expect(result.events).toStrictEqual([]);
    expect(result.state.objects[mountain]).toMatchObject({ damage: 0 });
  });
});

/** Deals damage as one event through the pipeline (CR 120.4). */
function dealDamage(state: GameState, damage: Damage[], cards: typeof TEST_CARDS) {
  return happen(state, { kind: "dealDamage", damage }, cards);
}
