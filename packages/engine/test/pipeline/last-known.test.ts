// Last known characteristics (D-096): snapshotted as permanents leave, all of a simultaneous batch from the state before
// it. No pool card shows the batch: the Druid's Forest is the only permanent whose characteristics a batch partner's
// leaving changes, and nothing reads a gone Forest's characteristics.

import { describe, expect, it } from "vitest";
import type { GameState, ObjectId } from "../../src/index.ts";
import { happen } from "../../src/pipeline/happen.ts";
import { BEARS, FOREST, TEST_CARDS } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

const permanent = (oracleId: string) => ({ oracleId, tapped: false, summoningSick: false, damage: 0, counters: {} });

/** Grizzly Bears standing in for Awakener Druid: the Forest is a 4/5 green Treefolk while the Bears are on the battlefield. */
function animated(): { state: GameState; druid: ObjectId; forest: ObjectId } {
  const started = start({
    seed: 1,
    players: [
      playerSetup("p1", { library: [FOREST], battlefield: [permanent(BEARS), permanent(FOREST)] }),
      playerSetup("p2", { library: [FOREST] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  }).state;
  const [druid, forest] = started.zones.battlefield as [ObjectId, ObjectId];
  const state: GameState = {
    ...started,
    effects: [
      {
        source: druid,
        controller: "p1",
        timestamp: 900,
        duration: "whileSourceOnBattlefield",
        affected: [forest],
        change: {
          kind: "becomes",
          addTypes: ["creature"],
          addSubtypes: ["Treefolk"],
          colors: { set: ["G"] },
          setPT: { power: 4, toughness: 5 },
        },
      },
    ],
  };
  return { state, druid, forest };
}

describe("last known characteristics (CR 608.2h)", () => {
  it("are taken for a whole batch before any of it, so a Forest destroyed with its Druid left as a creature (CR 704.8)", () => {
    const { state, druid, forest } = animated();
    const both = happen(
      state,
      {
        kind: "simultaneous",
        events: [
          { kind: "destroy", object: druid },
          { kind: "destroy", object: forest },
        ],
      },
      TEST_CARDS,
    );
    const known = both.state.lastKnownCharacteristics[forest];
    expect(known?.types).toContain("creature");
    expect(known?.subtypes).toContain("Treefolk");
    expect(known?.colors).toStrictEqual(["G"]);
    expect([known?.power, known?.toughness]).toStrictEqual([4, 5]);
  });

  it("aren't kept for a permanent that stays, or taken for events that move nothing off the battlefield", () => {
    const { state, forest } = animated();
    const tapped = happen(state, { kind: "tap", object: forest }, TEST_CARDS);
    expect(tapped.state.lastKnownCharacteristics).toStrictEqual({});
  });
});
