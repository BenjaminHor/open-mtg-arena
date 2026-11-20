// The event pipeline (src/pipeline/README.md): what performing each event does, and how the engine groups events that
// happen at the same time. With no replacement effects or triggers yet, the YAML scenarios see only end results, so
// the grouping is checked here, where the events are built.

import { describe, expect, it } from "vitest";
import { attackersTap } from "../../src/combat/declare-attackers.ts";
import { stateBasedActionsEvent } from "../../src/game/state-based-actions.ts";
import type { GameState, ObjectId } from "../../src/index.ts";
import { happen } from "../../src/pipeline/happen.ts";
import { perform } from "../../src/pipeline/perform.ts";
import type { ProposedEvent } from "../../src/pipeline/proposed.ts";
import { TEST_CARDS } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

const bears = { oracleId: "grizzly-bears", tapped: false, summoningSick: false, damage: 0, counters: {} };

/** p1 has two cards in their library, a land and a spell in hand, and two creatures; p2 has an empty library. */
function board(): GameState {
  return start({
    seed: 1,
    players: [
      playerSetup("p1", {
        library: ["forest", "mountain"],
        hand: ["forest", "shock"],
        battlefield: [bears, { ...bears, tapped: true }],
      }),
      playerSetup("p2", { library: [] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  }).state;
}

const creatures = (s: GameState) => s.zones.battlefield as [ObjectId, ObjectId];
const hand = (s: GameState) => (s.zones.players.p1?.hand ?? []) as [ObjectId, ObjectId];
const types = (event: ProposedEvent, state = board()) => happen(state, event, TEST_CARDS).events.map((e) => e.type);

describe("performing an event", () => {
  it("destroying a permanent moves it to its owner's graveyard, as one event (CR 701.8a)", () => {
    const state = board();
    const result = happen(state, { kind: "destroy", object: creatures(state)[0] }, TEST_CARDS);
    expect(result.events.map((e) => e.type)).toStrictEqual(["PERMANENT_DESTROYED", "ZONE_CHANGED"]);
    expect(result.state.zones.players.p1?.graveyard).toHaveLength(1);
  });

  it("drawing moves the top card of the library to the hand, one card per draw (CR 121.1, 121.2)", () => {
    const state = board();
    const top = state.zones.players.p1?.library[0];
    const result = happen(state, { kind: "draw", player: "p1" }, TEST_CARDS);
    expect(result.events.map((e) => e.type)).toStrictEqual(["ZONE_CHANGED", "CARD_DRAWN"]);
    expect(result.events[0]).toMatchObject({ oldId: top });
    expect(result.state.zones.players.p1?.library).toHaveLength(1);
  });

  it("drawing from an empty library moves nothing, and is remembered for state-based actions (CR 121.4)", () => {
    const result = happen(board(), { kind: "draw", player: "p2" }, TEST_CARDS);
    expect(result.events).toStrictEqual([]);
    expect(result.state.players.p2?.attemptedDrawFromEmptyLibrary).toBe(true);
  });

  it("discarding moves the card from hand to graveyard (CR 701.9a)", () => {
    const state = board();
    expect(types({ kind: "discard", object: hand(state)[0] }, state)).toStrictEqual(["ZONE_CHANGED", "CARD_DISCARDED"]);
  });

  it("reordering puts the given cards on top of the library in that order, and nothing else moves (CR 401.4)", () => {
    const state = board();
    const library = state.zones.players.p1?.library ?? [];
    const [a, b] = [library[1], library[0]] as [ObjectId, ObjectId];
    const after = happen(state, { kind: "reorderLibrary", player: "p1", top: [a, b] }, TEST_CARDS);
    expect(after.state.zones.players.p1?.library).toStrictEqual([a, b, ...library.slice(2)]);
    expect(after.events).toStrictEqual([]);
  });

  it("damage is all dealt, then turned into its results, in one event (CR 120.4b–c)", () => {
    const state = board();
    const [source] = creatures(state);
    const damage = [
      { source, to: { kind: "player", player: "p2" }, amount: 2, combat: true },
      { source, to: { kind: "object", object: source }, amount: 1, combat: true },
    ] as const;
    const result = happen(state, { kind: "dealDamage", damage: [...damage] }, TEST_CARDS);
    expect(result.events.map((e) => e.type)).toStrictEqual(["DAMAGE_DEALT", "DAMAGE_DEALT", "LIFE_LOST"]);
    expect(result.state.players.p2?.life).toBe(18);
    expect(result.state.objects[source]).toMatchObject({ damage: 1 });
  });

  it("playing a land moves it to the battlefield and counts the land play (CR 305.1, 305.2)", () => {
    const state = board();
    const result = happen(state, { kind: "playLand", player: "p1", object: hand(state)[0] }, TEST_CARDS);
    expect(result.events.map((e) => e.type)).toStrictEqual(["ZONE_CHANGED", "LAND_PLAYED"]);
    expect(result.state.players.p1?.landsPlayedThisTurn).toBe(1);
  });

  it("only an untapped permanent can be tapped, and only a tapped one untapped; otherwise nothing happens (CR 701.26a–b, 101.3)", () => {
    const state = board();
    const [untapped, tapped] = creatures(state);
    expect(types({ kind: "tap", object: untapped }, state)).toStrictEqual(["PERMANENT_TAPPED"]);
    expect(types({ kind: "untap", object: tapped }, state)).toStrictEqual(["PERMANENT_UNTAPPED"]);
    for (const event of [
      { kind: "tap", object: tapped },
      { kind: "untap", object: untapped },
    ] as const) {
      expect(happen(state, event, TEST_CARDS)).toStrictEqual({ state, events: [] });
    }
  });

  it("happen gives the same result as performing, while nothing replaces events", () => {
    const state = board();
    const event: ProposedEvent = { kind: "destroy", object: creatures(state)[0] };
    expect(happen(state, event, TEST_CARDS)).toStrictEqual(perform(state, event, TEST_CARDS));
  });
});

describe("events that happen at the same time are one event", () => {
  it("a batch performs every member, in the order listed", () => {
    const state = board();
    const [a, b] = creatures(state);
    const batch: ProposedEvent = {
      kind: "simultaneous",
      events: [
        { kind: "destroy", object: a },
        { kind: "untap", object: b },
      ],
    };
    expect(types(batch, state)).toStrictEqual(["PERMANENT_DESTROYED", "ZONE_CHANGED", "PERMANENT_UNTAPPED"]);
  });

  it("the state-based actions of one check are one event (CR 704.3), players' losses aside", () => {
    const actions = [
      { kind: "lethalDamage", object: "o1" },
      { kind: "zeroLife", player: "p2" },
      { kind: "zeroToughness", object: "o2" },
    ] as const;
    expect(stateBasedActionsEvent([...actions])).toStrictEqual({
      kind: "simultaneous",
      events: [
        { kind: "destroy", object: "o1" },
        { kind: "moveCard", object: "o2", to: { zone: "graveyard" } },
      ],
    });
  });

  it("the attackers tap together, as part of declaring them (CR 508.1f)", () => {
    const state = board();
    const [a, b] = creatures(state);
    const attacks = [
      { attacker: a, defender: "p2" },
      { attacker: b, defender: "p2" },
    ] as const;
    expect(attackersTap(state, [...attacks], TEST_CARDS)).toStrictEqual({
      kind: "simultaneous",
      events: [
        { kind: "tap", object: a },
        { kind: "tap", object: b },
      ],
    });
  });
});
