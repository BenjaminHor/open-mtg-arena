// Activating mana abilities: the checks that scenarios can't reach directly (CR 113.6, 605.1a, and reference matching).

import { describe, expect, it } from "vitest";
import { applyAction, manaValue, type ObjectId } from "../../src/index.ts";
import { manaAbilityProblem } from "../../src/mana/activate.ts";
import { TEST_CARDS } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

function game(hand: string[], battlefield: string[]) {
  return start({
    seed: 1,
    players: [
      playerSetup("p1", {
        library: ["forest"],
        hand,
        battlefield: battlefield.map((oracleId) => ({
          oracleId,
          tapped: false,
          summoningSick: false,
          damage: 0,
          counters: {},
        })),
      }),
      playerSetup("p2", { library: ["mountain"] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  });
}

describe("activating mana abilities", () => {
  it("only works for a permanent on the battlefield: a Forest in hand can't tap (CR 113.6)", () => {
    const g = game(["forest"], []);
    const inHand = g.state.zones.players.p1?.hand[0] as ObjectId;
    const pending = g.state.pending;
    if (pending === null) throw new Error("expected priority");
    const result = applyAction(
      g.state,
      {
        type: "ACTIVATE_ABILITY",
        decisionId: pending.id,
        player: "p1",
        object: inHand,
        ability: { kind: "basicLandType", landType: "Forest" },
      },
      TEST_CARDS,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "illegalAction", message: expect.stringMatching(/isn't a permanent/) },
    });
  });

  it("says the same of any card in a hidden zone, whatever abilities it has, so the refusal shows nothing of it", () => {
    const g = game(["forest", "furnace-whelp"], []);
    const [forest, whelp] = g.state.zones.players.p1?.hand ?? [];
    const problem = (object: ObjectId | undefined) =>
      manaAbilityProblem(g.state, "p1", object as ObjectId, { kind: "printed", index: 0 }, TEST_CARDS);
    // The Whelp has a printed ability 0 and the Forest none; both are refused for where they are, not what they are.
    expect(problem(forest)).toMatch(/isn't a permanent/);
    expect(problem(whelp)).toMatch(/isn't a permanent/);
  });

  it("refuses firebreathing because it isn't a mana ability, not because of its cost (CR 605.1a)", () => {
    const g = game([], ["furnace-whelp"]);
    const whelp = g.state.zones.battlefield[0] as ObjectId;
    // The Whelp's ability has a mana cost too; the reason must be that it isn't a mana ability.
    expect(manaAbilityProblem(g.state, "p1", whelp, { kind: "printed", index: 0 }, TEST_CARDS)).toMatch(
      /isn't a mana ability/,
    );
    const fakeTapAbility = {
      ...TEST_CARDS,
      "furnace-whelp": {
        ...(TEST_CARDS["furnace-whelp"] as NonNullable<(typeof TEST_CARDS)[string]>),
        def: {
          name: "Furnace Whelp",
          oracle: "",
          abilities: [
            {
              kind: "activated" as const,
              cost: [{ kind: "tap" as const }],
              targets: [],
              effects: [
                {
                  op: "modifyPT" as const,
                  power: 1,
                  toughness: 0,
                  of: "self" as const,
                  duration: "endOfTurn" as const,
                },
              ],
            },
          ],
        },
      },
    };
    expect(manaAbilityProblem(g.state, "p1", whelp, { kind: "printed", index: 0 }, fakeTapAbility)).toMatch(
      /isn't a mana ability/,
    );
  });

  it("matches ability references whatever the order of their keys", () => {
    const g = game([], ["mountain"]);
    const mountain = g.state.zones.battlefield[0] as ObjectId;
    const reordered = JSON.parse('{"landType":"Mountain","kind":"basicLandType"}');
    expect(manaAbilityProblem(g.state, "p1", mountain, reordered, TEST_CARDS)).toBeNull();
  });
});

describe("manaValue (CR 202.3)", () => {
  it("counts every mana symbol, and a card with no mana cost has mana value 0 (CR 202.3a)", () => {
    expect(
      manaValue([
        { kind: "generic", amount: 2 },
        { kind: "colored", color: "R" },
        { kind: "colored", color: "R" },
      ]),
    ).toBe(4);
    expect(manaValue(null)).toBe(0);
  });

  it("counts X as 0 off the stack (CR 107.3g)", () => {
    expect(manaValue([{ kind: "x" }, { kind: "colored", color: "R" }])).toBe(1);
  });
});
