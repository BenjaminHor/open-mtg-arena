// A land whose subtype is set (CR 305.7) loses every ability of its rules text: replacements, triggers, keywords and
// statics too, which no pool land has, so a test land shows them (the pool's checkland and Gargoyle Castle are in the
// scenarios).

import { describe, expect, it } from "vitest";
import type { ObjectId } from "../../src/index.ts";
import { abilitiesOf, keywordsOf, replacementsOf, staticAbilitiesOf, triggersOf } from "../../src/rules/abilities.ts";
import { subtypesOf } from "../../src/rules/card-types.ts";
import { TEST_CARDS, TEST_MIRAGE, TEST_ODD_LAND } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

const permanent = (oracleId: string) => ({ oracleId, tapped: false, summoningSick: false, damage: 0, counters: {} });

function oddLand(withMirage: boolean) {
  const state = start({
    seed: 1,
    players: [
      playerSetup("p1", {
        library: ["forest"],
        battlefield: [
          permanent(TEST_ODD_LAND),
          ...(withMirage
            ? [
                {
                  ...permanent(TEST_MIRAGE),
                  attachedTo: { player: "p1" as const, index: 0 },
                  chosenLandType: "Island" as const,
                },
              ]
            : []),
        ],
      }),
      playerSetup("p2", { library: ["forest"] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  }).state;
  return { state, land: state.zones.battlefield[0] as ObjectId };
}

describe("a land whose subtype is set loses its rules text's abilities (CR 305.7)", () => {
  it("has them all without the Aura", () => {
    const { state, land } = oddLand(false);
    expect(replacementsOf(state, land, TEST_CARDS)).toHaveLength(1);
    expect(triggersOf(state, land, TEST_CARDS)).toHaveLength(1);
    expect(keywordsOf(state, land, TEST_CARDS)).toStrictEqual(["shroud"]);
    expect(staticAbilitiesOf(state, land, TEST_CARDS)).toHaveLength(1);
  });

  it("has none of them with it, only the chosen type's mana ability", () => {
    const { state, land } = oddLand(true);
    expect(subtypesOf(state, land, TEST_CARDS)).toStrictEqual(["Island"]);
    expect(replacementsOf(state, land, TEST_CARDS)).toStrictEqual([]);
    expect(triggersOf(state, land, TEST_CARDS)).toStrictEqual([]);
    expect(keywordsOf(state, land, TEST_CARDS)).toStrictEqual([]);
    expect(staticAbilitiesOf(state, land, TEST_CARDS)).toStrictEqual([]);
    expect(abilitiesOf(state, land, TEST_CARDS).map((a) => a.ref)).toStrictEqual([
      { kind: "basicLandType", landType: "Island" },
    ]);
  });
});
