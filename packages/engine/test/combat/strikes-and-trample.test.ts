// First strike, double strike and trample cases no Magic 2010 card can show (CR 510.4, 702.4, 702.7c, 702.19d,
// 702.2c), on test creatures. Gaining or losing a keyword between the two combat damage steps is simulated by changing
// the creature's card in the state, since no effect grants keywords yet.

import { describe, expect, it } from "vitest";
import { checkStateBasedActions } from "../../src/game/state-based-actions.ts";
import type { GameEvent, GameState, ObjectId } from "../../src/index.ts";
import {
  BEARS,
  DEATHTOUCH_TRAMPLER,
  DOUBLE_LIFELINKER,
  DOUBLE_STRIKER,
  DOUBLE_TRAMPLER,
  FIRST_STRIKER,
  FOREST,
  TEST_CARDS,
} from "../support/cards.ts";
import { answer, type Game, passBoth, playerSetup, start, take } from "../support/game.ts";

const permanent = (oracleId: string) => ({ oracleId, tapped: false, summoningSick: false, damage: 0, counters: {} });

/** p1 in their precombat main phase with these permanents, p2 with theirs. */
function board(mine: string[], theirs: string[]): Game {
  return start({
    seed: 1,
    players: [
      playerSetup("p1", { library: [FOREST, FOREST], battlefield: mine.map(permanent) }),
      playerSetup("p2", { library: [FOREST, FOREST], battlefield: theirs.map(permanent) }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  });
}

/** Declares these attackers and these blocks, ending with priority in the declare blockers step. */
function combat(game: Game, attackers: ObjectId[], blocks: [ObjectId, ObjectId][] = []): Game {
  let g = passBoth(passBoth(game)); // to declare attackers
  for (const attacker of attackers) g = answer(g, { kind: "declareAttacker", attack: { attacker, defender: "p2" } });
  g = passBoth(answer(g, { kind: "finishDeclaring" }));
  if (g.state.pending?.kind !== "declareBlockers") return g;
  for (const [blocker, attacker] of blocks) g = answer(g, { kind: "declareBlocker", block: { blocker, attacker } });
  return answer(g, { kind: "finishDeclaring" });
}

/** The creature becomes another test card, as if it gained or lost a keyword. */
function becomes(game: Game, id: ObjectId, oracleId: string): Game {
  const obj = game.state.objects[id];
  if (obj?.kind !== "card") throw new Error(`no card ${id}`);
  return { ...game, state: { ...game.state, objects: { ...game.state.objects, [id]: { ...obj, oracleId } } } };
}

const since = (game: Game, before: number): GameEvent[] => game.events.slice(before);
const hits = (events: GameEvent[], source: ObjectId) =>
  events.filter((e) => e.type === "DAMAGE_DEALT" && e.source === source).length;
const life = (state: GameState, player: "p1" | "p2") => state.players[player]?.life;

describe("double strike (CR 702.4b, 510.4)", () => {
  it("deals combat damage in both steps, and lifelink gains life each time, as separate events", () => {
    let game = board([DOUBLE_LIFELINKER], []);
    const [striker] = game.state.zones.battlefield as [ObjectId];
    game = combat(game, [striker]);
    game = passBoth(game);
    expect(game.state.turn?.step).toBe("combatDamage");
    expect(life(game.state, "p2")).toBe(18);
    const before = game.events.length;
    game = passBoth(game);
    expect(game.state.turn?.step).toBe("combatDamage");
    expect(life(game.state, "p2")).toBe(16);
    expect(hits(since(game, before), striker)).toBe(1);
    expect(game.events.filter((e) => e.type === "LIFE_GAINED")).toHaveLength(2);
    expect(life(game.state, "p1")).toBe(24);
  });

  it("removed during the first step: no second hit (CR 702.4c)", () => {
    let game = board([DOUBLE_STRIKER], []);
    const [striker] = game.state.zones.battlefield as [ObjectId];
    game = passBoth(combat(game, [striker]));
    game = passBoth(becomes(game, striker, BEARS));
    expect(life(game.state, "p2")).toBe(18);
  });

  it("given to a first striker after it dealt damage: it deals damage again (CR 702.4d)", () => {
    let game = board([FIRST_STRIKER], []);
    const [striker] = game.state.zones.battlefield as [ObjectId];
    game = passBoth(combat(game, [striker]));
    expect(life(game.state, "p2")).toBe(18);
    game = passBoth(becomes(game, striker, DOUBLE_STRIKER));
    expect(life(game.state, "p2")).toBe(16);
  });
});

describe("a double striker without trample (CR 510.1c, 510.4)", () => {
  it("deals nothing in the second step once its blocker died in the first", () => {
    let game = board([DOUBLE_STRIKER], [BEARS]);
    const [striker, bears] = game.state.zones.battlefield as [ObjectId, ObjectId];
    game = passBoth(combat(game, [striker], [[bears, striker]]));
    expect(game.state.zones.battlefield).not.toContain(bears);
    const before = game.events.length;
    game = passBoth(game);
    expect(hits(since(game, before), striker)).toBe(0);
    expect(life(game.state, "p2")).toBe(20);
  });
});

describe("first strike gained or lost between the steps (CR 702.7c)", () => {
  it("gained after the first step: the creature still deals its damage in the second, and there's no third", () => {
    let game = board([FIRST_STRIKER, BEARS], []);
    const [striker, bears] = game.state.zones.battlefield as [ObjectId, ObjectId];
    game = passBoth(combat(game, [striker, bears]));
    expect(life(game.state, "p2")).toBe(18);
    game = passBoth(becomes(game, bears, FIRST_STRIKER));
    expect(life(game.state, "p2")).toBe(16);
    game = passBoth(game);
    expect(game.state.turn?.step).toBe("endOfCombat");
  });

  it("lost after the first step: the creature doesn't deal damage again", () => {
    let game = board([FIRST_STRIKER, BEARS], []);
    const [striker, bears] = game.state.zones.battlefield as [ObjectId, ObjectId];
    game = passBoth(combat(game, [striker, bears]));
    const before = game.events.length;
    game = passBoth(becomes(game, striker, BEARS));
    expect(hits(since(game, before), striker)).toBe(0);
    expect(hits(since(game, before), bears)).toBe(1);
  });
});

describe("the second combat damage step (CR 510.4, 500.5)", () => {
  it("empties mana pools between the two steps", () => {
    let game = board([FIRST_STRIKER, FOREST], []);
    const [striker, forest] = game.state.zones.battlefield as [ObjectId, ObjectId];
    game = passBoth(combat(game, [striker]));
    game = take(game, (a) => a.type === "ACTIVATE_ABILITY" && a.object === forest);
    expect(game.state.players.p1?.manaPool.G).toBe(1);
    game = passBoth(game);
    expect(game.state.turn?.step).toBe("combatDamage");
    expect(game.state.players.p1?.manaPool.G).toBe(0);
  });
});

describe("trample", () => {
  it("with deathtouch, 1 damage is lethal to each blocker, and the rest can go to the player (CR 702.2c)", () => {
    let game = board([DEATHTOUCH_TRAMPLER], [BEARS, BEARS]);
    const [trampler, b1, b2] = game.state.zones.battlefield as [ObjectId, ObjectId, ObjectId];
    game = passBoth(
      combat(
        game,
        [trampler],
        [
          [b1, trampler],
          [b2, trampler],
        ],
      ),
    );
    expect(game.state.pending).toMatchObject({ kind: "assignDamage", lethal: [1, 1], amount: 5 });
    // Giving the first blocker 0 means the last must take everything left: the player can't get any (CR 702.19b).
    const zero = answer(game, { kind: "assignDamage", amount: 0 });
    expect(() => answer(zero, { kind: "assignDamage", amount: 1 })).toThrow(/isn't a legal answer/);
    game = answer(game, { kind: "assignDamage", amount: 1 });
    game = answer(game, { kind: "assignDamage", amount: 1 });
    expect(life(game.state, "p2")).toBe(17);
    expect(game.state.zones.players.p2?.graveyard).toHaveLength(2);
  });

  it("with double strike, after its blocker died in the first step, deals all its damage to the player (CR 702.19d)", () => {
    let game = board([DOUBLE_TRAMPLER], [BEARS]);
    const [trampler, bears] = game.state.zones.battlefield as [ObjectId, ObjectId];
    game = passBoth(combat(game, [trampler], [[bears, trampler]]));
    game = answer(game, { kind: "assignDamage", amount: 2 });
    expect(life(game.state, "p2")).toBe(18);
    expect(game.state.zones.battlefield).not.toContain(bears);
    game = passBoth(game);
    expect(game.state.pending?.kind).toBe("priority");
    expect(life(game.state, "p2")).toBe(14);
  });
});

describe("the deathtouch record (CR 704.5h)", () => {
  it("is cleared by every check, even one that finds nothing to do", () => {
    const game = board([BEARS], []);
    const [bears] = game.state.zones.battlefield as [ObjectId];
    // A creature that left the battlefield after it was dealt deathtouch damage is no longer anything to destroy.
    const state: GameState = { ...game.state, dealtDeathtouchDamage: ["o99" as ObjectId] };
    const checked = checkStateBasedActions(state, TEST_CARDS);
    expect(checked.performed).toBe(false);
    expect(checked.state.dealtDeathtouchDamage).toStrictEqual([]);
    const touched = checkStateBasedActions({ ...game.state, dealtDeathtouchDamage: [bears] }, TEST_CARDS);
    expect(touched.performed).toBe(true);
    expect(touched.state.zones.battlefield).not.toContain(bears);
  });
});
