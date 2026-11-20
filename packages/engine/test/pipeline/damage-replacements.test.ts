// Prevention per damage entry (D-088): which entry a choice is for, by its place in the event as proposed, and entries
// that are never dealt. The scenarios in `scenarios/cards/m2-08d/` play the cards; these test what no pool card can
// reach: one source dealing damage to one recipient twice in one event, and damage to a recipient that left.

import { describe, expect, it } from "vitest";
import type { GameState, ObjectId } from "../../src/index.ts";
import { replaceDamage } from "../../src/pipeline/damage-replacements.ts";
import { happen } from "../../src/pipeline/happen.ts";
import type { Damage } from "../../src/pipeline/proposed.ts";
import type { ReplacementEffect } from "../../src/state/replacements.ts";
import { BEARS, FOREST, MOUNTAIN, TEST_CARDS } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

/** p2's Grizzly Bears, with a Fog-like effect (everyone) and a Safe-Passage-like one (p1 and p1's creatures). */
function withTwoPreventions(): { state: GameState; bears: ObjectId } {
  const started = start({
    seed: 1,
    players: [
      playerSetup("p1", { library: [FOREST] }),
      playerSetup("p2", {
        library: [FOREST],
        battlefield: [{ oracleId: BEARS, tapped: false, summoningSick: false, damage: 0, counters: {} }],
      }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p2", step: "precombatMain" } },
    ruleModifiers: [],
  }).state;
  const [bears] = started.zones.battlefield as [ObjectId];
  const fogLike: ReplacementEffect = {
    kind: "preventAllDamage",
    id: "o901",
    sourceOracleId: FOREST,
    controller: "p2",
    combatOnly: false,
    protects: "everyone",
  };
  const passageLike: ReplacementEffect = {
    ...fogLike,
    id: "o902",
    sourceOracleId: MOUNTAIN,
    controller: "p1",
    protects: "controllerAndCreatures",
  };
  return { state: { ...started, replacements: [fogLike, passageLike] }, bears };
}

const toP1 = (source: ObjectId, amount: number): Damage => ({
  source,
  to: { kind: "player", player: "p1" },
  amount,
  combat: false,
});

describe("prevention per damage entry (CR 616.1, D-088)", () => {
  it("drops damage to a recipient that left before any effect sees it, and keys a choice by the entry's place", () => {
    const { state, bears } = withTwoPreventions();
    const gone: Damage = { source: bears, to: { kind: "object", object: "o999" }, amount: 3, combat: false };
    const asked = replaceDamage(state, [gone, toP1(bears, 2)], TEST_CARDS, []);
    // Only the second entry is asked about, and it keeps its place (1), though the first was dropped.
    expect(asked).toMatchObject({
      kind: "choose",
      player: "p1",
      for: { kind: "damage", index: 1, source: bears, to: { kind: "player", player: "p1" } },
    });
    // Once chosen, nothing is prevented for the gone recipient: the Fog-like effect isn't used on it.
    const choice = {
      kind: "first",
      for: { kind: "damage", index: 1, source: bears, to: { kind: "player", player: "p1" } },
    } as const;
    const replaced = replaceDamage(state, [gone, toP1(bears, 2)], TEST_CARDS, [
      { ...choice, ref: { kind: "resolvedEffect", id: "o902" } },
    ]);
    expect(replaced).toStrictEqual({
      kind: "replaced",
      events: [
        { kind: "damagePrevented", source: bears, to: { kind: "player", player: "p1" }, amount: 2, by: MOUNTAIN },
        { kind: "dealDamage", damage: [] },
      ],
    });
  });

  it("doesn't use a choice made for one entry on another with the same source and recipient", () => {
    const { state, bears } = withTwoPreventions();
    const firstChoice = {
      kind: "first",
      for: { kind: "damage", index: 0, source: bears, to: { kind: "player", player: "p1" } },
      ref: { kind: "resolvedEffect", id: "o902" },
    } as const;
    const asked = replaceDamage(state, [toP1(bears, 1), toP1(bears, 1)], TEST_CARDS, [firstChoice]);
    expect(asked).toMatchObject({ kind: "choose", for: { kind: "damage", index: 1 } });
    const secondChoice = { ...firstChoice, for: { ...firstChoice.for, index: 1 } } as const;
    const replaced = replaceDamage(state, [toP1(bears, 1), toP1(bears, 1)], TEST_CARDS, [firstChoice, secondChoice]);
    expect(replaced).toStrictEqual({
      kind: "replaced",
      events: [
        { kind: "damagePrevented", source: bears, to: { kind: "player", player: "p1" }, amount: 1, by: MOUNTAIN },
        { kind: "damagePrevented", source: bears, to: { kind: "player", player: "p1" }, amount: 1, by: MOUNTAIN },
        { kind: "dealDamage", damage: [] },
      ],
    });
  });
});

describe("a redirection effect's amount (Harm's Way; CR 614.9, 615.7)", () => {
  it("redirects 1, keeps 1 for the source's next damage this turn, then is used up", () => {
    const { state: base, bears } = withTwoPreventions();
    const redirect: ReplacementEffect = {
      kind: "redirectDamage",
      id: "o903",
      sourceOracleId: FOREST,
      controller: "p1",
      from: bears,
      remaining: 2,
      to: { kind: "player", player: "p2" },
    };
    const state = { ...base, replacements: [redirect] };
    const first = happen(state, { kind: "dealDamage", damage: [toP1(bears, 1)] }, TEST_CARDS).state;
    expect([first.players.p1?.life, first.players.p2?.life]).toStrictEqual([20, 19]);
    expect(first.replacements).toStrictEqual([{ ...redirect, remaining: 1 }]);
    const second = happen(first, { kind: "dealDamage", damage: [toP1(bears, 2)] }, TEST_CARDS).state;
    expect([second.players.p1?.life, second.players.p2?.life]).toStrictEqual([19, 18]);
    expect(second.replacements).toStrictEqual([]);
  });
});
