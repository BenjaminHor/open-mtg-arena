// Regeneration shields (CR 701.19a) where a scenario can't see them: they live in `GameState.replacements`.

import { describe, expect, it } from "vitest";
import { addRegenerationShields } from "../../src/effects/regeneration-shield.ts";
import { checkStateBasedActions } from "../../src/game/state-based-actions.ts";
import type { GameState, ObjectId } from "../../src/index.ts";
import { happen } from "../../src/pipeline/happen.ts";
import { BEARS, FOREST, HOLLOW_STATUE, IRON_WALL, TEST_CARDS } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

/** p1 with these permanents, each with a regeneration shield. */
function shielded(oracleIds: string[]): GameState {
  const state = start({
    seed: 1,
    players: [
      playerSetup("p1", {
        library: [FOREST],
        battlefield: oracleIds.map((oracleId) => ({
          oracleId,
          tapped: false,
          summoningSick: false,
          damage: 0,
          counters: {},
        })),
      }),
      playerSetup("p2", { library: [] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  }).state;
  return addRegenerationShields(state, state.zones.battlefield).state;
}

describe("regeneration shields", () => {
  it("aren't used by a destroy that can't happen: an indestructible creature keeps its shield (CR 614.17c)", () => {
    const state = shielded([IRON_WALL]);
    const [wall] = state.zones.battlefield as [ObjectId];
    const after = happen(state, { kind: "destroy", object: wall }, TEST_CARDS);
    expect(after.events).toStrictEqual([]);
    expect(after.state.replacements).toStrictEqual([{ kind: "regenerationShield", object: wall }]);
  });

  it("don't save a creature with toughness 0, which isn't destroyed (CR 704.5f, 701.19a)", () => {
    // A 0/0 would die as the game starts; it's put onto the battlefield, with a shield, only now.
    const state = shielded([]);
    const statue = "o900" as ObjectId;
    const withStatue: GameState = {
      ...state,
      objects: { ...state.objects, [statue]: { ...cardLike(state), id: statue, oracleId: HOLLOW_STATUE } },
      zones: { ...state.zones, battlefield: [statue] },
      replacements: [{ kind: "regenerationShield", object: statue }],
    };
    const after = checkStateBasedActions(withStatue, TEST_CARDS).state;
    expect(after.zones.battlefield).toStrictEqual([]);
    expect(after.zones.players.p1?.graveyard).toHaveLength(1);
  });

  it("are used one at a time, and the creature is tapped with its damage removed", () => {
    const once = shielded([BEARS]);
    const [bears] = once.zones.battlefield as [ObjectId];
    const twice = addRegenerationShields(once, [bears]).state;
    const after = happen(twice, { kind: "destroy", object: bears }, TEST_CARDS);
    expect(after.state.replacements).toStrictEqual([{ kind: "regenerationShield", object: bears }]);
    expect(after.state.objects[bears]).toMatchObject({ tapped: true, damage: 0 });
    expect(after.events.map((e) => e.type)).toStrictEqual(["PERMANENT_REGENERATED", "PERMANENT_TAPPED"]);
  });
});

/** A card object to copy: p1's library card. */
function cardLike(state: GameState) {
  const id = state.zones.players.p1?.library[0] as ObjectId;
  const obj = state.objects[id];
  if (obj?.kind !== "card") throw new Error("no card to copy");
  return obj;
}
