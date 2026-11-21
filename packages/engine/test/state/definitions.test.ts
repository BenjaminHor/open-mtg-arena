// The CR's definitions as the engine's types and objects follow them: colors, mana, card types, zones, owners and
// controllers, status, and what an ability on the stack is.

import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type CardType,
  type Color,
  controllerOf,
  type GameState,
  type ManaType,
  type ObjectId,
  type PlayerZoneName,
  type SharedZoneName,
  type Supertype,
  type ZoneName,
} from "../../src/index.ts";
import { BEARS, FOREST, MOUNTAIN, SHOCK, TEST_CARDS, WHELP } from "../support/cards.ts";
import { type Game, passBoth, playerSetup, start, take } from "../support/game.ts";

describe("the types follow the CR's lists", () => {
  it("has the five colors (CR 105.1), and mana of each plus colorless (CR 106.1a, 106.1b)", () => {
    expectTypeOf<Color>().toEqualTypeOf<"W" | "U" | "B" | "R" | "G">();
    expectTypeOf<ManaType>().toEqualTypeOf<Color | "C">();
  });

  it("has the card types and supertypes a deck can hold (CR 205.2a, 205.4a)", () => {
    expectTypeOf<CardType>().toEqualTypeOf<
      "artifact" | "battle" | "creature" | "enchantment" | "instant" | "kindred" | "land" | "planeswalker" | "sorcery"
    >();
    expectTypeOf<Supertype>().toEqualTypeOf<"basic" | "legendary" | "snow" | "world">();
  });

  it("has each player's zones and the shared ones (CR 400.1), without ante", () => {
    expectTypeOf<PlayerZoneName>().toEqualTypeOf<"library" | "hand" | "graveyard">();
    expectTypeOf<SharedZoneName>().toEqualTypeOf<"battlefield" | "stack" | "exile" | "command">();
    expectTypeOf<ZoneName>().toEqualTypeOf<PlayerZoneName | SharedZoneName>();
  });
});

const permanent = { tapped: false, summoningSick: false, damage: 0, counters: {} };

function game(): Game {
  return start({
    seed: 1,
    players: [
      playerSetup("p1", {
        library: [FOREST, MOUNTAIN],
        hand: [SHOCK],
        battlefield: [
          { oracleId: MOUNTAIN, ...permanent },
          { oracleId: WHELP, ...permanent },
        ],
      }),
      playerSetup("p2", {
        library: [FOREST],
        // Tapped, damaged, with a +1/+1 counter: a 3/3 that Shock's 2 damage finishes.
        battlefield: [{ oracleId: BEARS, ...permanent, tapped: true, damage: 1, counters: { "+1/+1": 1 } }],
      }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  });
}

const zone = (s: GameState, p: "p1" | "p2", z: PlayerZoneName) => s.zones.players[p]?.[z] ?? [];

describe("objects, owners and controllers", () => {
  it("makes each player's deck their library, in order (CR 401.1), owned by them (CR 108.3)", () => {
    const { state } = game();
    const library = zone(state, "p1", "library").map((id) => state.objects[id]);
    expect(library.map((o) => o?.kind === "card" && o.oracleId)).toEqual([FOREST, MOUNTAIN]);
    expect(library.every((o) => o?.kind === "card" && o.owner === "p1")).toBe(true);
  });

  it("answers a card's owner when asked for the controller of a card that has none (CR 108.4, 108.4a)", () => {
    const { state } = game();
    for (const p of ["p1", "p2"] as const) {
      for (const id of zone(state, p, "library")) expect(controllerOf(state, id, TEST_CARDS)).toBe(p);
    }
  });

  it("makes a permanent that leaves a new object with no status and no counters (CR 110.5d, 122.2, 400.7)", () => {
    const before = game();
    const bears = before.state.zones.battlefield[2] as ObjectId;
    const after = shockTheBears(before);
    const [dead] = zone(after.state, "p2", "graveyard");
    expect(dead).not.toBe(bears);
    // A card off the battlefield is neither tapped nor untapped (CR 110.5d); the engine keeps `tapped: false` there.
    expect(after.state.objects[dead as ObjectId]).toMatchObject({ tapped: false, damage: 0, counters: {} });
  });

  it("puts a card into its owner's graveyard even when another player controlled it (CR 400.3)", () => {
    const g = game();
    const bears = g.state.zones.battlefield[2] as ObjectId;
    const obj = g.state.objects[bears];
    if (obj?.kind !== "card") throw new Error("the Bears are a card");
    // No effect in the pool changes control, so make p1 the Bears' controller by hand.
    const stolen: Game = {
      ...g,
      state: { ...g.state, objects: { ...g.state.objects, [bears]: { ...obj, baseController: "p1" } } },
    };
    expect(controllerOf(stolen.state, bears, TEST_CARDS)).toBe("p1");
    const after = shockTheBears(stolen);
    expect(zone(after.state, "p2", "graveyard")).toHaveLength(1);
    expect(zone(after.state, "p1", "graveyard").map((id) => after.state.objects[id])).toMatchObject([
      { oracleId: SHOCK },
    ]);
  });

  it("makes an activated ability on the stack an object of its own, not a card (CR 109.1, 113.1c)", () => {
    const g = game();
    const whelp = g.state.zones.battlefield[1] as ObjectId;
    const activated = take(g, (a) => a.type === "ACTIVATE_ABILITY" && a.object === whelp);
    const [ability] = activated.state.zones.stack;
    expect(activated.state.objects[ability as ObjectId]).toMatchObject({ kind: "ability", source: whelp });
    expect(activated.state.objects[ability as ObjectId]).not.toHaveProperty("cardId");
  });
});

/** p1 casts Shock at p2's Bears, pays with the Mountain, and both players pass: the Bears die. */
function shockTheBears(g: Game): Game {
  let next = take(g, (a) => a.type === "CAST_SPELL");
  const bears = g.state.zones.battlefield[2];
  next = take(
    next,
    (a) =>
      a.type === "ANSWER" &&
      a.answer.kind === "chooseTarget" &&
      a.answer.target.kind === "object" &&
      a.answer.target.object === bears,
  );
  const mountain = g.state.zones.battlefield[0];
  next = take(next, (a) => a.type === "ACTIVATE_ABILITY" && a.object === mountain);
  next = take(next, (a) => a.type === "ANSWER" && a.answer.kind === "payMana");
  return passBoth(next);
}
