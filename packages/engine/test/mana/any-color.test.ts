// "Add one mana of any color" (Birds of Paradise, D-068): the color comes with the activation, legalActions lists one
// activation per color, and autoPay keeps an any-color source for a color nothing else makes.

import { describe, expect, it } from "vitest";
import { autoPay, type CardDatabase, legalActions } from "../../src/index.ts";
import { FOREST, HASTY_ELF, TEST_CARDS } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

const permanent = (oracleId: string) => ({ oracleId, tapped: false, summoningSick: false, damage: 0, counters: {} });

// The hasty elf as Birds of Paradise: "{T}: Add one mana of any color."
const elf = TEST_CARDS[HASTY_ELF];
if (elf === undefined) throw new Error("no hasty elf");
const CARDS: CardDatabase = {
  ...TEST_CARDS,
  [HASTY_ELF]: {
    ...elf,
    def: {
      ...elf.def,
      abilities: [
        {
          kind: "activated",
          cost: [{ kind: "tap" }],
          targets: [],
          effects: [{ op: "addMana", mana: "anyColor", amount: 1 }],
        },
      ],
    },
  },
};

const board = (battlefield: string[]) =>
  start({
    seed: 1,
    players: [
      playerSetup("p1", { library: [FOREST], battlefield: battlefield.map(permanent) }),
      playerSetup("p2", { library: [FOREST] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  }).state;

describe("mana of any color (CR 106.1a, 605.3b)", () => {
  it("is listed once per color, never colorless", () => {
    const state = board([HASTY_ELF]);
    const colors = legalActions(state, "p1", CARDS).flatMap((a) =>
      a.type === "ACTIVATE_ABILITY" && a.color !== undefined ? [a.color] : [],
    );
    expect(colors).toStrictEqual(["W", "U", "B", "R", "G"]);
  });

  it("is used by autoPay after the fixed-color sources, for the color they can't make", () => {
    const state = board([HASTY_ELF, FOREST]);
    const plan = autoPay(
      state,
      "p1",
      [
        { kind: "colored", color: "G" },
        { kind: "colored", color: "U" },
      ],
      CARDS,
    );
    const [elfId, forestId] = state.zones.battlefield;
    expect(plan?.activations).toStrictEqual([
      { object: forestId, ability: { kind: "basicLandType", landType: "Forest" } },
      { object: elfId, ability: { kind: "printed", index: 0 }, color: "U" },
    ]);
  });
});
