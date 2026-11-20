// The event pipeline (src/pipeline/README.md): what `perform` does with each event, and above all which events it
// proposes again through `next`, since that's where each part of a compound event gets its own replacement pass
// (later: CR 614). The YAML scenarios see only the end result, which is the same either way.

import { describe, expect, it } from "vitest";
import type { GameState, ObjectId } from "../../src/index.ts";
import { happen } from "../../src/pipeline/happen.ts";
import { perform } from "../../src/pipeline/perform.ts";
import type { CarryOut, ProposedEvent } from "../../src/pipeline/proposed.ts";
import { TEST_CARDS } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

const bears = { oracleId: "grizzly-bears", tapped: false, summoningSick: false, damage: 0, counters: {} };

/** p1 has two cards in their library, a land and a spell in hand, and a creature; p2 has an empty library. */
function board(): GameState {
  return start({
    seed: 1,
    players: [
      playerSetup("p1", { library: ["forest", "mountain"], hand: ["forest", "shock"], battlefield: [bears] }),
      playerSetup("p2", { library: [] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  }).state;
}

const creature = (s: GameState) => s.zones.battlefield[0] as ObjectId;
const hand = (s: GameState) => s.zones.players.p1?.hand ?? [];

/** Performs an event, recording every event it proposes again, at any depth, in order. */
function performRecording(state: GameState, event: ProposedEvent) {
  const proposed: ProposedEvent[] = [];
  const next: CarryOut = (s, e) => {
    proposed.push(e);
    return perform(s, e, TEST_CARDS, next);
  };
  return { ...perform(state, event, TEST_CARDS, next), proposed };
}

describe("compound events propose their parts again (each gets its own replacement pass)", () => {
  it("destroying a permanent proposes moving it to its owner's graveyard (CR 701.8a)", () => {
    const state = board();
    const result = performRecording(state, { kind: "destroy", object: creature(state) });
    expect(result.proposed).toStrictEqual([{ kind: "moveCard", object: creature(state), to: { zone: "graveyard" } }]);
    expect(result.events.map((e) => e.type)).toStrictEqual(["PERMANENT_DESTROYED", "ZONE_CHANGED"]);
  });

  it("drawing proposes moving the top card of the library to the hand (CR 121.1)", () => {
    const state = board();
    const top = state.zones.players.p1?.library[0] as ObjectId;
    const result = performRecording(state, { kind: "draw", player: "p1" });
    expect(result.proposed).toStrictEqual([{ kind: "moveCard", object: top, to: { zone: "hand" } }]);
    expect(result.events.map((e) => e.type)).toStrictEqual(["ZONE_CHANGED", "CARD_DRAWN"]);
  });

  it("drawing from an empty library proposes nothing, and is remembered for state-based actions (CR 121.4)", () => {
    const result = performRecording(board(), { kind: "draw", player: "p2" });
    expect(result.proposed).toStrictEqual([]);
    expect(result.state.players.p2?.attemptedDrawFromEmptyLibrary).toBe(true);
  });

  it("discarding proposes one zone change per card (CR 701.9a)", () => {
    const state = board();
    const [land, spell] = hand(state) as [ObjectId, ObjectId];
    const result = performRecording(state, { kind: "discard", objects: [land, spell] });
    expect(result.proposed).toStrictEqual([
      { kind: "moveCard", object: land, to: { zone: "graveyard" } },
      { kind: "moveCard", object: spell, to: { zone: "graveyard" } },
    ]);
  });

  it("dealing damage proposes each result after all the damage is dealt (CR 120.4b–c)", () => {
    const state = board();
    const source = creature(state);
    const result = performRecording(state, {
      kind: "dealDamage",
      damage: [
        { source, to: { kind: "player", player: "p2" }, amount: 2, combat: true },
        { source, to: { kind: "object", object: source }, amount: 1, combat: true },
      ],
    });
    expect(result.proposed).toStrictEqual([
      { kind: "loseLife", player: "p2", amount: 2 },
      { kind: "markDamage", object: source, amount: 1 },
    ]);
    expect(result.events.map((e) => e.type)).toStrictEqual(["DAMAGE_DEALT", "DAMAGE_DEALT", "LIFE_LOST"]);
  });

  it("playing a land proposes moving it to the battlefield, then counts the land play (CR 305.1, 305.2)", () => {
    const state = board();
    const land = hand(state)[0] as ObjectId;
    const result = performRecording(state, { kind: "playLand", player: "p1", object: land });
    expect(result.proposed).toStrictEqual([
      { kind: "moveCard", object: land, to: { zone: "battlefield", controller: "p1" } },
    ]);
    expect(result.events.map((e) => e.type)).toStrictEqual(["ZONE_CHANGED", "LAND_PLAYED"]);
    expect(result.state.players.p1?.landsPlayedThisTurn).toBe(1);
  });

  it("simultaneous events propose each member, in order (CR 704.3)", () => {
    const state = board();
    const members: ProposedEvent[] = [
      { kind: "tap", object: creature(state) },
      { kind: "loseLife", player: "p1", amount: 1 },
    ];
    const result = performRecording(state, { kind: "simultaneous", events: members });
    expect(result.proposed).toStrictEqual(members);
    expect(result.events.map((e) => e.type)).toStrictEqual(["PERMANENT_TAPPED", "LIFE_LOST"]);
  });

  it("an event with no parts proposes nothing", () => {
    const state = board();
    const atomic: ProposedEvent[] = [
      { kind: "moveCard", object: creature(state), to: { zone: "exile" } },
      { kind: "loseLife", player: "p1", amount: 1 },
      { kind: "markDamage", object: creature(state), amount: 1 },
      { kind: "tap", object: creature(state) },
      { kind: "untap", objects: [creature(state)] },
      { kind: "addMana", player: "p1", mana: "G", amount: 1, source: creature(state) },
      { kind: "shuffle", player: "p1" },
    ];
    for (const event of atomic) expect(performRecording(state, event).proposed).toStrictEqual([]);
  });
});

describe("happen", () => {
  it("carries out the parts of a compound event", () => {
    const state = board();
    const result = happen(state, { kind: "destroy", object: creature(state) }, TEST_CARDS);
    expect(result.events.map((e) => e.type)).toStrictEqual(["PERMANENT_DESTROYED", "ZONE_CHANGED"]);
    expect(result.state.zones.battlefield).toStrictEqual([]);
    expect(result.state.zones.players.p1?.graveyard).toHaveLength(1);
  });

  it("gives the same result as performing with nothing to replace", () => {
    const state = board();
    const event: ProposedEvent = { kind: "discard", objects: hand(state) };
    expect(happen(state, event, TEST_CARDS)).toStrictEqual(
      (({ proposed: _p, ...progress }) => progress)(performRecording(state, event)),
    );
  });
});
